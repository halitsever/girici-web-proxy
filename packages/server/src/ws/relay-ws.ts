import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import type { Duplex } from "node:stream";
import { rootCertificates, connect as tlsConnect } from "node:tls";
import type { RelayErrorCode } from "@girici/engine/shared";
import { WebSocket, WebSocketServer, type ClientOptions, type RawData } from "ws";
import { isAdminCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientIp, clientKey, compileTrust, type TrustFn } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import type { Limiter } from "../http/rate-limit.ts";
import { NO_OBSERVER, type Direction, type RelayObserver } from "../http/relay-observer.ts";
import type { Logger } from "../log.ts";
import type { TunnelDialer } from "../upstream/agent.ts";
import type { HostBlocklist } from "../upstream/blocklist.ts";
import { relayErrorFor } from "../upstream/errors.ts";
import { proxyFailureLog } from "../upstream/proxy-failure.ts";
import { SsrfBlockedError, validateTarget, type TargetPolicy } from "../upstream/ssrf.ts";
import { openWsSeal } from "./seal.ts";

const WS_PATH = "/_g/ws";
const SUBPROTOCOL = "girici.v1";
const DEFAULT_MAX_PAYLOAD = 16 * 1024 * 1024;
const DEFAULT_HANDSHAKE_MS = 15_000;
const DEFAULT_MAX_PER_IP = 20;
const FIRST_FRAME_MS = 10_000;
const PING_MS = 30_000;
const HIGH_WATER = 1024 * 1024;
const SHUTDOWN_GRACE_MS = 2000;

/** The control frame the shim sends first: url, subprotocols and the seal the service worker had made. */
interface ControlFrame {
  u: string;
  p?: string[];
  s?: string | null;
}

export type Dial = (
  target: URL,
  init: {
    headers: Record<string, string>;
    protocols: string[];
    lookup: LookupFunction;
    maxPayload: number;
    handshakeTimeout: number;
  },
) => WebSocket;

/** A gate's refusal, answered as plain HTTP before the upgrade. */
export interface UpgradeRefusal {
  code: RelayErrorCode;
  status: 403 | 429;
  retryAfter?: number;
}

export type UpgradeGate = (req: IncomingMessage, key: string) => UpgradeRefusal | null;

export interface WsRelayOptions {
  allowedTestHosts: ReadonlySet<string>;
  lookup: LookupFunction;
  logger: Logger;
  authStore?: AuthStore;
  maxPayload?: number;
  handshakeTimeoutMs?: number;
  maxPerIp?: number;
  dial?: Dial;
  trust?: TrustFn;
  limiter?: Limiter | null;
  blocklist?: HostBlocklist;
  /** Set when GIRICI_UPSTREAM_PROXY is: upstream sockets then open through the proxy instead of directly. */
  tunnel?: TunnelDialer;
  observer?: RelayObserver;
  /** Run in order after the auth check and before the rate limiter; the first refusal answers the upgrade. */
  upgradeGates?: readonly UpgradeGate[];
  /** Asked after each frame is counted; false closes the client with 1008 "quota". The admin is never cut. */
  allowFrame?: (key: string) => boolean;
}

export interface WsRelayHandle {
  /** Closes every relay with 1001 and resolves once all are gone; sockets still open after graceMs are cut. */
  close(graceMs?: number): Promise<void>;
}

/** Bridge state shared by every connection of one relay. */
interface BridgeOptions extends WsRelayOptions {
  dial: Dial;
  maxPayload: number;
  live: Set<WebSocket>;
  onUpstreamError: (error: unknown) => void;
  observer: RelayObserver;
}

/** One client socket: its rate-limit key, and whether allowFrame may cut it. */
interface Connection {
  key: string;
  limited: boolean;
}

/** Open sockets per client; an entry leaves with its last socket, so the map holds only live clients. */
export class PerClientCount {
  readonly #counts = new Map<string, number>();

  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  take(key: string, max: number): boolean {
    const count = this.count(key);
    if (count >= max) return false;
    this.#counts.set(key, count + 1);
    return true;
  }

  release(key: string): void {
    const left = this.count(key) - 1;
    if (left > 0) this.#counts.set(key, left);
    else this.#counts.delete(key);
  }

  get size(): number {
    return this.#counts.size;
  }
}

/** Codes the browser refuses to send in close(); reflect them as sendable equivalents. */
export function mapCloseCode(code: number): number {
  if (code === 1005) return 1000;
  if (code === 1006 || code === 1015) return 1011;
  return code;
}

/** ws/wss only, with the same SSRF rules as the HTTP relay, checked against the http(s) equivalent. */
export function validateWsTarget(url: URL, policy: TargetPolicy): void {
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new SsrfBlockedError(`Scheme ${url.protocol} is not allowed`);
  const httpEquivalent = new URL(url.href);
  httpEquivalent.protocol = url.protocol === "wss:" ? "https:" : "http:";
  validateTarget(httpEquivalent, policy);
}

const MAX_SEAL = 4096;

/** Fields go straight into Buffer and ws calls, which throw on a wrong type inside a listener and end the process. */
function parseControlFrame(data: RawData, isBinary: boolean): ControlFrame | null {
  if (isBinary) return null;
  let value: unknown;
  try {
    value = JSON.parse(data.toString());
  } catch {
    return null;
  }
  const { u, p, s } = (value ?? {}) as Record<string, unknown>;
  if (typeof u !== "string") return null;
  if (p !== undefined && !(Array.isArray(p) && p.every((item) => typeof item === "string"))) return null;
  if (s !== undefined && s !== null && (typeof s !== "string" || s.length > MAX_SEAL)) return null;
  return { u, p: p as string[] | undefined, s: s as string | null | undefined };
}

/** Same rule as the HTTP gate: open when public, else a valid session for the current admin. */
function wsAuthorized(store: AuthStore | undefined, cookie: string | undefined): boolean {
  if (!store || store.publicAccess()) return true;
  return isAdminCookie(store, cookie);
}

/** A plain HTTP answer lets the browser's WebSocket fail fast instead of waiting on a silently dropped socket. */
function refuse(socket: Duplex, status: number, retryAfter?: number): void {
  const wait = retryAfter === undefined ? "" : `Retry-After: ${retryAfter}\r\n`;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n${wait}Connection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

function defaultDial(tunnel: TunnelDialer | undefined): Dial {
  return (target, init) =>
    new WebSocket(target.href, init.protocols, {
      headers: init.headers,
      followRedirects: false,
      handshakeTimeout: init.handshakeTimeout,
      maxPayload: init.maxPayload,
      ...(tunnel ? { createConnection: tunneledConnection(tunnel, target) } : { lookup: init.lookup }),
    });
}

/**
 * Test mode only: fixture names point at local servers while TLS still checks the original name, as the HTTP agent
 * does for its requests.
 */
export function testUpstreamDial(
  testUpstreams: ReadonlyMap<string, { host: string; port: number }>,
  testCa: string | undefined,
): Dial {
  return (target, init) => {
    const mapped = testUpstreams.get(target.hostname);
    const connection: ClientOptions["createConnection"] | undefined = mapped
      ? () =>
          tlsConnect({
            host: mapped.host,
            port: mapped.port,
            servername: target.hostname,
            ALPNProtocols: ["http/1.1"],
            ...(testCa ? { ca: [...rootCertificates, testCa] } : {}),
          })
      : undefined;
    return new WebSocket(target.href, init.protocols, {
      headers: init.headers,
      followRedirects: false,
      handshakeTimeout: init.handshakeTimeout,
      maxPayload: init.maxPayload,
      ...(connection ? { createConnection: connection } : { lookup: init.lookup }),
    });
  };
}

/** ws passes this to http.request, which waits for the callback, so the tunnel may open asynchronously. */
function tunneledConnection(tunnel: TunnelDialer, target: URL): ClientOptions["createConnection"] {
  const port = Number(target.port) || (target.protocol === "wss:" ? 443 : 80);
  const create = (options: { timeout?: number }, callback: (error: Error | null, socket?: Duplex) => void) => {
    tunnel(target.hostname, port).then(
      (socket) => {
        // ws enforces its handshake timeout through the socket's idle timeout, which net.connect would have set.
        const timeout = options.timeout ?? 0;
        if (target.protocol !== "wss:") {
          socket.setTimeout(timeout);
          // The tunnel comes back paused, and http only adds a data listener.
          socket.resume();
          callback(null, socket);
          return;
        }
        const secure = tlsConnect({ socket, ...tlsIdentity(target), ALPNProtocols: ["http/1.1"] });
        secure.setTimeout(timeout);
        // http queues its writes until the handshake ends, and a TLS failure reaches the request as a socket error.
        callback(null, secure);
      },
      (error: Error) => callback(error),
    );
  };
  return create as unknown as ClientOptions["createConnection"];
}

/** Without host, TLS over an existing socket verifies the proxy's name instead of the target's. */
export function tlsIdentity(target: URL): { host: string; servername?: string } {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) ? { host } : { host, servername: host };
}

/** Mount the WebSocket relay on the HTTP server's upgrade event. */
export function attachWsRelay(server: Server, options: WsRelayOptions): WsRelayHandle {
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  const maxPerIp = options.maxPerIp ?? DEFAULT_MAX_PER_IP;
  const dial = options.dial ?? defaultDial(options.tunnel);
  const trust = options.trust ?? compileTrust(false);
  const wss = new WebSocketServer({ noServer: true, maxPayload, handleProtocols: () => SUBPROTOCOL });
  const perClient = new PerClientCount();
  // Client and upstream sockets, so shutdown can say goodbye to both ends.
  const live = new Set<WebSocket>();
  const onUpstreamError = proxyFailureLog(options.logger);
  const observer = options.observer ?? NO_OBSERVER;
  let closing = false;

  server.on("upgrade", (req, socket, head) => {
    if (closing) {
      socket.destroy();
      return;
    }
    const url = URL.parse(req.url ?? "", "http://localhost");
    if (!url || url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!isOwnHost(req.headers.origin, req.headers.host)) {
      observer.answered("ws", "bad_request");
      socket.destroy();
      return;
    }
    if (!wsAuthorized(options.authStore, req.headers.cookie)) {
      observer.answered("ws", "auth");
      socket.destroy();
      return;
    }
    const ip = clientKey(clientIp(req, trust));
    for (const gate of options.upgradeGates ?? []) {
      const refusal = gate(req, ip);
      if (!refusal) continue;
      observer.answered("ws", refusal.code);
      refuse(socket, refusal.status, refusal.retryAfter);
      return;
    }
    const limit = options.limiter?.(ip);
    if (limit && !limit.ok && !(options.authStore && isAdminCookie(options.authStore, req.headers.cookie))) {
      observer.answered("ws", "rate_limited");
      refuse(socket, 429, limit.retryAfter);
      return;
    }
    if (perClient.count(ip) >= maxPerIp) {
      observer.answered("ws", "rate_limited");
      refuse(socket, 429, 1);
      return;
    }
    // Checked once here, so an admin's socket is never cut mid-stream.
    const limited =
      options.allowFrame !== undefined && !(options.authStore && isAdminCookie(options.authStore, req.headers.cookie));
    wss.handleUpgrade(req, socket, head, (client) => {
      // Counted only once upgraded: a handshake ws rejects never reaches this callback to give its slot back.
      if (!perClient.take(ip, maxPerIp)) {
        observer.answered("ws", "rate_limited");
        client.close(1013, "busy");
        return;
      }
      track(live, client);
      client.once("close", () => perClient.release(ip));
      bridge(client, req, { key: ip, limited }, { ...options, maxPayload, dial, live, onUpstreamError, observer });
    });
  });

  return {
    close(graceMs = SHUTDOWN_GRACE_MS) {
      closing = true;
      const sockets = [...live];
      if (sockets.length === 0) return Promise.resolve();
      return new Promise((resolve) => {
        let left = sockets.length;
        const cut = setTimeout(() => {
          for (const ws of sockets) ws.terminate();
        }, graceMs);
        for (const ws of sockets) {
          ws.once("close", () => {
            if (--left > 0) return;
            clearTimeout(cut);
            resolve();
          });
          if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
          else ws.close(1001, "server shutting down");
        }
      });
    },
  };
}

function track(live: Set<WebSocket>, ws: WebSocket): void {
  live.add(ws);
  ws.once("close", () => live.delete(ws));
}

function bridge(client: WebSocket, req: IncomingMessage, conn: Connection, options: BridgeOptions): void {
  const firstFrameTimer = setTimeout(() => {
    options.observer.answered("ws", "bad_request");
    client.close(1008, "no control frame");
  }, FIRST_FRAME_MS);
  // A client that leaves before its control frame was neither served nor refused.
  client.once("close", () => clearTimeout(firstFrameTimer));
  client.once("message", (data, isBinary) => {
    clearTimeout(firstFrameTimer);
    // Closing already, for example during shutdown: no new upstream.
    if (client.readyState !== WebSocket.OPEN) return;
    const frame = parseControlFrame(data, isBinary);
    const target = frame ? URL.parse(frame.u) : null;
    if (!frame || !target) {
      options.observer.answered("ws", "bad_request");
      client.close(1008, "bad control frame");
      return;
    }
    if (options.blocklist?.isBlocked(target.hostname)) {
      options.logger.debug(`ws blocked by list ${target.host}`);
      options.observer.answered("ws", "blocked");
      client.close(1008, "blocked");
      return;
    }
    try {
      validateWsTarget(target, { allowedTestHosts: options.allowedTestHosts, selfHost: req.headers.host });
    } catch (error) {
      options.logger.debug(`ws blocked ${target.host}`);
      const ssrf = error instanceof SsrfBlockedError;
      options.observer.answered("ws", ssrf ? "ssrf_blocked" : "bad_request");
      client.close(1011, ssrf ? "blocked" : "invalid");
      return;
    }
    const forward: Record<string, string> = {};
    for (const name of ["user-agent", "accept-language"] as const) {
      const value = req.headers[name];
      if (typeof value === "string") forward[name] = value;
    }
    connectUpstream(client, target, frame, forward, conn, options);
  });
}

function connectUpstream(
  client: WebSocket,
  target: URL,
  frame: ControlFrame,
  forward: Record<string, string>,
  conn: Connection,
  options: BridgeOptions,
): void {
  // Cookie and Origin come only from a seal the server made for this target; a page cannot read or forge one.
  const secret = options.authStore?.sessionSecret();
  const sealed = frame.s && secret ? openWsSeal(secret, frame.s, target) : null;
  const headers: Record<string, string> = { ...forward, origin: sealed?.origin ?? httpOrigin(target) };
  if (sealed?.cookie) headers.cookie = sealed.cookie;

  let answered = false;
  const answer = (code: RelayErrorCode | null) => {
    if (answered) return;
    answered = true;
    options.observer.answered("ws", code);
  };
  let setCookies: string[] = [];
  let upstream: WebSocket;
  try {
    upstream = options.dial(target, {
      headers,
      protocols: frame.p ?? [],
      lookup: options.lookup,
      maxPayload: options.maxPayload,
      handshakeTimeout: options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_MS,
    });
  } catch (error) {
    reportUpstreamError(error, target, options);
    answer(relayErrorFor(error).code);
    client.close(1011, "connect");
    return;
  }
  track(options.live, upstream);

  upstream.once("upgrade", (res: IncomingMessage) => {
    setCookies = res.headers["set-cookie"] ?? [];
  });
  const allowFrame = options.allowFrame;
  /** Counts first, so the frame that crosses a budget still costs its bytes, and is then dropped, not relayed. */
  const passes = (bytes: number, direction: Direction): boolean => {
    options.observer.bytes(conn.key, bytes, direction);
    if (!conn.limited || !allowFrame || allowFrame(conn.key)) return true;
    client.close(1008, "quota");
    return false;
  };
  upstream.on("open", () => {
    answer(null);
    client.once("close", () => options.observer.socketClosed());
    client.send(JSON.stringify({ t: "open", p: upstream.protocol, sc: setCookies }));
    pipe(client, upstream, (bytes) => passes(bytes, "up"));
    pipe(upstream, client, (bytes) => passes(bytes, "down"));
  });

  const ping = setInterval(() => {
    if (client.readyState === WebSocket.OPEN) client.ping();
    if (upstream.readyState === WebSocket.OPEN) upstream.ping();
  }, PING_MS);

  const closeBoth = (end: WebSocket, code: number, reason: Buffer) => {
    clearInterval(ping);
    const safe = mapCloseCode(code);
    const text = reason.subarray(0, 123);
    if (end.readyState === WebSocket.OPEN || end.readyState === WebSocket.CONNECTING) {
      try {
        end.close(safe, text);
      } catch {
        end.terminate();
      }
    }
  };
  upstream.on("close", (code, reason) => closeBoth(client, code, reason));
  client.on("close", (code, reason) => closeBoth(upstream, code, reason));
  upstream.on("error", (error) => {
    reportUpstreamError(error, target, options);
    if (upstream.readyState !== WebSocket.OPEN && client.readyState === WebSocket.OPEN) {
      answer(relayErrorFor(error).code);
      client.close(1011, "upstream");
    }
  });
  client.on("error", () => upstream.terminate());
}

function reportUpstreamError(error: unknown, target: URL, options: BridgeOptions): void {
  options.logger.debug(`ws ${relayErrorFor(error).code} ${target.host}`);
  options.onUpstreamError(error);
}

/** Browsers send the page's http(s) origin on a handshake, never a ws: one. */
function httpOrigin(target: URL): string {
  return `${target.protocol === "wss:" ? "https:" : "http:"}//${target.host}`;
}

function pipe(from: WebSocket, to: WebSocket, passes: (bytes: number) => boolean): void {
  from.on("message", (data, isBinary) => {
    if (to.readyState !== WebSocket.OPEN || !passes(payloadLength(data))) return;
    to.send(data, { binary: isBinary });
    const source = socketOf(from);
    if (to.bufferedAmount > HIGH_WATER && source) source.pause();
  });
  const dest = socketOf(to);
  if (dest) dest.on("drain", () => socketOf(from)?.resume());
}

function payloadLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

function socketOf(ws: WebSocket): Duplex | undefined {
  return (ws as unknown as { _socket?: Duplex })._socket;
}
