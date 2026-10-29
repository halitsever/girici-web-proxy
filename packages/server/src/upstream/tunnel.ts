import { connect as netConnect, isIP, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import ipaddr from "ipaddr.js";
import type { UpstreamProxy } from "./proxy-config.ts";

/** Who failed decides the page: a broken proxy is the operator's problem, an unreachable target is the site's. */
export class UpstreamProxyError extends Error {
  readonly kind: "proxy" | "target";

  constructor(kind: "proxy" | "target", message: string) {
    super(message);
    this.kind = kind;
  }
}

interface Target {
  host: string;
  port: number;
}

const MAX_REPLY_HEAD = 16 * 1024;
const HTTP_TARGET_FAILURES = new Set([502, 503, 504]);
// RFC 1928 replies that blame the destination: network or host unreachable, refused, TTL expired.
const SOCKS_TARGET_FAILURES = new Set([3, 4, 5, 6]);

/**
 * Opens a tunnel to target through the proxy. The socket comes back paused, with any bytes the proxy sent after its
 * reply pushed back onto it, so the consumer resumes it and reads exactly from where the tunnel begins.
 */
export function openTunnel(
  proxy: UpstreamProxy,
  target: Target,
  options: { timeout: number; ca?: string[] },
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secure = proxy.protocol === "https";
    const socket = secure
      ? tlsConnect({
          host: proxy.host,
          port: proxy.port,
          servername: isIP(proxy.host) ? undefined : proxy.host,
          ...(options.ca ? { ca: options.ca } : {}),
        })
      : netConnect({ host: proxy.host, port: proxy.port });
    let settled = false;
    const settle = (error: UpstreamProxyError | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (!error) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(error);
    };
    const onError = (error: NodeJS.ErrnoException) =>
      settle(new UpstreamProxyError("proxy", `Upstream proxy connection failed (${error.code ?? "error"})`));
    const onClose = () => settle(new UpstreamProxyError("proxy", "Upstream proxy closed the connection"));
    const timer = setTimeout(
      () => settle(new UpstreamProxyError("proxy", "Upstream proxy timed out")),
      options.timeout,
    );
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.once(secure ? "secureConnect" : "connect", () => {
      const handshake =
        proxy.protocol === "socks5" || proxy.protocol === "socks5h"
          ? socks5(socket, proxy, target)
          : httpConnect(socket, proxy, target);
      handshake.then(
        (rest) => {
          if (rest.length > 0) socket.unshift(rest);
          settle(null);
        },
        (error: unknown) =>
          settle(
            error instanceof UpstreamProxyError
              ? error
              : new UpstreamProxyError("proxy", "Upstream proxy handshake failed"),
          ),
      );
    });
  });
}

async function httpConnect(socket: Socket, proxy: UpstreamProxy, target: Target): Promise<Buffer> {
  const authority = `${isIP(target.host) === 6 ? `[${target.host}]` : target.host}:${target.port}`;
  const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`];
  if (proxy.username !== undefined || proxy.password !== undefined) {
    const credentials = Buffer.from(`${proxy.username ?? ""}:${proxy.password ?? ""}`).toString("base64");
    lines.push(`Proxy-Authorization: Basic ${credentials}`);
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  const { head, rest } = await read(socket, (buffer) => {
    const end = buffer.indexOf("\r\n\r\n");
    if (end !== -1) return end + 4;
    if (buffer.length > MAX_REPLY_HEAD) throw new UpstreamProxyError("proxy", "Upstream proxy reply is too large");
    return null;
  });
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.toString("latin1"))?.[1] ?? 0);
  if (status >= 200 && status < 300) return rest;
  throw new UpstreamProxyError(
    HTTP_TARGET_FAILURES.has(status) ? "target" : "proxy",
    `Upstream proxy answered CONNECT with ${status || "a malformed reply"}`,
  );
}

async function socks5(socket: Socket, proxy: UpstreamProxy, target: Target): Promise<Buffer> {
  const login = proxy.username !== undefined || proxy.password !== undefined;
  socket.write(Buffer.from(login ? [5, 2, 0, 2] : [5, 1, 0]));
  const choice = await read(socket, (buffer) => (buffer.length >= 2 ? 2 : null));
  const method = choice.head[1];
  if (choice.head[0] !== 5 || !(method === 0 || (method === 2 && login))) {
    throw new UpstreamProxyError("proxy", "Upstream SOCKS proxy accepted none of the offered login methods");
  }
  let leftover = choice.rest;
  if (method === 2) {
    const user = Buffer.from(proxy.username ?? "");
    const pass = Buffer.from(proxy.password ?? "");
    if (user.length > 255 || pass.length > 255) throw new UpstreamProxyError("proxy", "SOCKS credentials are too long");
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
    const answer = await read(socket, (buffer) => (buffer.length >= 2 ? 2 : null), leftover);
    if (answer.head[1] !== 0) throw new UpstreamProxyError("proxy", "Upstream SOCKS proxy refused the login");
    leftover = answer.rest;
  }
  const port = Buffer.from([target.port >> 8, target.port & 0xff]);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(target.host), port]));
  const reply = await read(socket, socksReplySize, leftover);
  const code = reply.head[1] ?? 1;
  if (code === 0) return reply.rest;
  throw new UpstreamProxyError(
    SOCKS_TARGET_FAILURES.has(code) ? "target" : "proxy",
    `Upstream SOCKS proxy replied ${code}`,
  );
}

function socksAddress(host: string): Buffer {
  const family = isIP(host);
  if (family === 4) return Buffer.from([1, ...host.split(".").map(Number)]);
  if (family === 6) return Buffer.from([4, ...ipaddr.parse(host).toByteArray()]);
  const name = Buffer.from(host);
  if (name.length > 255) throw new UpstreamProxyError("proxy", "Target name is too long for SOCKS5");
  return Buffer.concat([Buffer.from([3, name.length]), name]);
}

function socksReplySize(buffer: Buffer): number | null {
  if (buffer.length < 5) return null;
  const type = buffer[3];
  const size = type === 1 ? 10 : type === 4 ? 22 : type === 3 ? 7 + (buffer[4] ?? 0) : -1;
  if (buffer[0] !== 5 || size === -1)
    throw new UpstreamProxyError("proxy", "Upstream SOCKS proxy sent a malformed reply");
  return buffer.length >= size ? size : null;
}

/** Reads until need() names the size of a complete reply, then pauses the socket so nothing after it is lost. */
function read(
  socket: Socket,
  need: (buffer: Buffer) => number | null,
  initial: Buffer = Buffer.alloc(0),
): Promise<{ head: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = initial;
    const done = (): boolean => {
      let size: number | null;
      try {
        size = need(buffer);
      } catch (error) {
        reject(error);
        return true;
      }
      if (size === null) return false;
      resolve({ head: buffer.subarray(0, size), rest: buffer.subarray(size) });
      return true;
    };
    if (done()) return;
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!done()) return;
      socket.pause();
      socket.off("data", onData);
    };
    socket.on("data", onData);
    socket.resume();
  });
}
