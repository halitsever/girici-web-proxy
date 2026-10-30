import type { IncomingMessage, Server } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { WebSocket, WebSocketServer, type ClientOptions, type RawData } from "ws";
import { isAdminCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientIp, clientKey, compileTrust, type TrustFn } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import type { Limiter } from "../http/rate-limit.ts";
import type { Logger } from "../log.ts";
import type { TunnelDialer } from "../upstream/agent.ts";
import type { HostBlocklist } from "../upstream/blocklist.ts";
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

/** A plain 429 lets the browser's WebSocket fail fast instead of waiting on a silently dropped socket. */
function refuse(socket: Duplex, retryAfter: number): void {
  socket.end(
    `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
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
export function attachWsRelay(server: Server, options: WsRelayOptions): void {
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  const maxPerIp = options.maxPerIp ?? DEFAULT_MAX_PER_IP;
  const dial = options.dial ?? defaultDial(options.tunnel);
  const trust = options.trust ?? compileTrust(false);
  const wss = new WebSocketServer({ noServer: true, maxPayload, handleProtocols: () => SUBPROTOCOL });
  const perClient = new PerClientCount();

  server.on("upgrade", (req, socket, head) => {
    const url = URL.parse(req.url ?? "", "http://localhost");
    if (!url || url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!isOwnHost(req.headers.origin, req.headers.host)) {
      socket.destroy();
      return;
    }
    if (!wsAuthorized(options.authStore, req.headers.cookie)) {
      socket.destroy();
      return;
    }
    const ip = clientKey(clientIp(req, trust));
    const limit = options.limiter?.(ip);
    if (limit && !limit.ok && !(options.authStore && isAdminCookie(options.authStore, req.headers.cookie))) {
      refuse(socket, limit.retryAfter);
      return;
    }
    if (perClient.count(ip) >= maxPerIp) {
      refuse(socket, 1);
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      // Counted only once upgraded: a handshake ws rejects never reaches this callback to give its slot back.
      if (!perClient.take(ip, maxPerIp)) {
        client.close(1013, "busy");
        return;
      }
      client.once("close", () => perClient.release(ip));
      bridge(client, req, { ...options, maxPayload, dial });
    });
  });
}

function bridge(
  client: WebSocket,
  req: IncomingMessage,
  options: Required<Pick<WsRelayOptions, "dial" | "maxPayload">> & WsRelayOptions,
): void {
  const firstFrameTimer = setTimeout(() => client.close(1008, "no control frame"), FIRST_FRAME_MS);
  client.once("message", (data, isBinary) => {
    clearTimeout(firstFrameTimer);
    const frame = parseControlFrame(data, isBinary);
    const target = frame ? URL.parse(frame.u) : null;
    if (!frame || !target) {
      client.close(1008, "bad control frame");
      return;
    }
    if (options.blocklist?.isBlocked(target.hostname)) {
      options.logger.debug(`ws blocked by list ${target.host}`);
      client.close(1008, "blocked");
      return;
    }
    try {
      validateWsTarget(target, { allowedTestHosts: options.allowedTestHosts, selfHost: req.headers.host });
    } catch (error) {
      options.logger.debug(`ws blocked ${target.host}`);
      client.close(1011, error instanceof SsrfBlockedError ? "blocked" : "invalid");
      return;
    }
    const forward: Record<string, string> = {};
    for (const name of ["user-agent", "accept-language"] as const) {
      const value = req.headers[name];
      if (typeof value === "string") forward[name] = value;
    }
    connectUpstream(client, target, frame, forward, options);
  });
}

function connectUpstream(
  client: WebSocket,
  target: URL,
  frame: ControlFrame,
  forward: Record<string, string>,
  options: WsRelayOptions & { dial: Dial; maxPayload: number },
): void {
  // Cookie and Origin come only from a seal the server made for this target; a page cannot read or forge one.
  const secret = options.authStore?.sessionSecret();
  const sealed = frame.s && secret ? openWsSeal(secret, frame.s, target) : null;
  const headers: Record<string, string> = { ...forward, origin: sealed?.origin ?? httpOrigin(target) };
  if (sealed?.cookie) headers.cookie = sealed.cookie;

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
  } catch {
    client.close(1011, "connect");
    return;
  }

  upstream.once("upgrade", (res: IncomingMessage) => {
    setCookies = res.headers["set-cookie"] ?? [];
  });
  upstream.on("open", () => {
    client.send(JSON.stringify({ t: "open", p: upstream.protocol, sc: setCookies }));
    pipe(client, upstream);
    pipe(upstream, client);
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
  upstream.on("error", () => {
    if (upstream.readyState !== WebSocket.OPEN && client.readyState === WebSocket.OPEN) client.close(1011, "upstream");
  });
  client.on("error", () => upstream.terminate());
}

/** Browsers send the page's http(s) origin on a handshake, never a ws: one. */
function httpOrigin(target: URL): string {
  return `${target.protocol === "wss:" ? "https:" : "http:"}//${target.host}`;
}

function pipe(from: WebSocket, to: WebSocket): void {
  from.on("message", (data, isBinary) => {
    if (to.readyState !== WebSocket.OPEN) return;
    to.send(data, { binary: isBinary });
    const source = socketOf(from);
    if (to.bufferedAmount > HIGH_WATER && source) source.pause();
  });
  const dest = socketOf(to);
  if (dest) dest.on("drain", () => socketOf(from)?.resume());
}

function socketOf(ws: WebSocket): Duplex | undefined {
  return (ws as unknown as { _socket?: Duplex })._socket;
}
