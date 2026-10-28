import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { LookupFunction } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Logger } from "../log.ts";
import { SsrfBlockedError, validateTarget, type TargetPolicy } from "../upstream/ssrf.ts";

const WS_PATH = "/_g/ws";
const SUBPROTOCOL = "girici.v1";
const DEFAULT_MAX_PAYLOAD = 16 * 1024 * 1024;
const DEFAULT_HANDSHAKE_MS = 15_000;
const DEFAULT_MAX_PER_IP = 20;
const FIRST_FRAME_MS = 10_000;
const PING_MS = 30_000;
const HIGH_WATER = 1024 * 1024;

/** The control frame the shim sends first: url, subprotocols, cookie, origin. */
interface ControlFrame {
  u: string;
  p?: string[];
  c?: string;
  o?: string;
}

export type Dial = (target: URL, init: { headers: Record<string, string>; protocols: string[]; lookup: LookupFunction; maxPayload: number; handshakeTimeout: number }) => WebSocket;

export interface WsRelayOptions {
  allowedTestHosts: ReadonlySet<string>;
  lookup: LookupFunction;
  logger: Logger;
  maxPayload?: number;
  handshakeTimeoutMs?: number;
  maxPerIp?: number;
  dial?: Dial;
}

/** Codes the browser refuses to send in close(); reflect them as sendable equivalents. */
export function mapCloseCode(code: number): number {
  if (code === 1005) return 1000;
  if (code === 1006 || code === 1015) return 1011;
  return code;
}

/** ws/wss only, with the same SSRF rules as the HTTP relay, checked against the http(s) equivalent. */
export function validateWsTarget(url: URL, policy: TargetPolicy): void {
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new SsrfBlockedError(`Scheme ${url.protocol} is not allowed`);
  const httpEquivalent = new URL(url.href);
  httpEquivalent.protocol = url.protocol === "wss:" ? "https:" : "http:";
  validateTarget(httpEquivalent, policy);
}

function parseControlFrame(data: RawData, isBinary: boolean): ControlFrame | null {
  if (isBinary) return null;
  try {
    const value = JSON.parse(data.toString()) as ControlFrame;
    return typeof value?.u === "string" ? value : null;
  } catch {
    return null;
  }
}

function isOwnOrigin(origin: string | undefined, host: string | undefined): boolean {
  const url = origin ? URL.parse(origin) : null;
  return !!url && (url.protocol === "http:" || url.protocol === "https:") && url.host === host?.toLowerCase();
}

const defaultDial: Dial = (target, init) =>
  new WebSocket(target.href, init.protocols, {
    headers: init.headers,
    lookup: init.lookup,
    followRedirects: false,
    handshakeTimeout: init.handshakeTimeout,
    maxPayload: init.maxPayload,
  });

/** Mount the WebSocket relay on the HTTP server's upgrade event. */
export function attachWsRelay(server: Server, options: WsRelayOptions): void {
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  const maxPerIp = options.maxPerIp ?? DEFAULT_MAX_PER_IP;
  const dial = options.dial ?? defaultDial;
  const wss = new WebSocketServer({ noServer: true, maxPayload, handleProtocols: () => SUBPROTOCOL });
  const perIp = new Map<string, number>();

  server.on("upgrade", (req, socket, head) => {
    const url = URL.parse(req.url ?? "", "http://localhost");
    if (!url || url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!isOwnOrigin(req.headers.origin, req.headers.host)) {
      socket.destroy();
      return;
    }
    const ip = req.socket.remoteAddress ?? "?";
    if ((perIp.get(ip) ?? 0) >= maxPerIp) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      client.once("close", () => perIp.set(ip, Math.max((perIp.get(ip) ?? 1) - 1, 0)));
      bridge(client, req, { ...options, maxPayload, dial });
    });
  });
}

function bridge(client: WebSocket, req: IncomingMessage, options: Required<Pick<WsRelayOptions, "dial" | "maxPayload">> & WsRelayOptions): void {
  const firstFrameTimer = setTimeout(() => client.close(1008, "no control frame"), FIRST_FRAME_MS);
  client.once("message", (data, isBinary) => {
    clearTimeout(firstFrameTimer);
    const frame = parseControlFrame(data, isBinary);
    const target = frame ? URL.parse(frame.u) : null;
    if (!frame || !target) {
      client.close(1008, "bad control frame");
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
  const headers: Record<string, string> = { ...forward, origin: frame.o ?? target.origin };
  if (frame.c) headers.cookie = frame.c;

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
