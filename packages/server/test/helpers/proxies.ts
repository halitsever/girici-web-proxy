import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer as createNetServer, type AddressInfo, type Server, type Socket } from "node:net";
import ipaddr from "ipaddr.js";
import type { UpstreamProxy } from "../../src/upstream/proxy-config.ts";
import type { TestCert } from "./upstream.ts";

export const httpProxy = (port: number): UpstreamProxy => ({ protocol: "http", host: "127.0.0.1", port });
export const socksProxy = (port: number): UpstreamProxy => ({ protocol: "socks5", host: "127.0.0.1", port });

interface Closable {
  port: number;
  close(): Promise<void>;
}

/** A TCP echo server on 127.0.0.1. */
export async function startEcho(): Promise<Closable> {
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    track(sockets, socket);
    socket.pipe(socket);
  });
  return { port: await listen(server), close: () => shut(server, sockets) };
}

/** A TCP server on 127.0.0.1 that accepts connections and never answers. */
export async function startSilent(): Promise<Closable> {
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => track(sockets, socket));
  return { port: await listen(server), close: () => shut(server, sockets) };
}

/** An HTTP CONNECT proxy that records each target and its Proxy-Authorization header. */
export async function startConnectProxy(
  options: { auth?: string; status?: number; earlyData?: string; tls?: TestCert } = {},
): Promise<Closable & { targets: string[]; authHeaders: Array<string | undefined> }> {
  const targets: string[] = [];
  const authHeaders: Array<string | undefined> = [];
  const sockets = new Set<Socket>();
  const server: HttpServer = options.tls
    ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert })
    : createHttpServer();
  server.on("connection", (socket: Socket) => track(sockets, socket));
  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    const target = req.url ?? "";
    targets.push(target);
    const auth = req.headers["proxy-authorization"];
    authHeaders.push(auth);
    client.on("error", () => {});
    if (options.auth && auth !== `Basic ${Buffer.from(options.auth).toString("base64")}`) {
      client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      return;
    }
    if (options.status) {
      client.end(`HTTP/1.1 ${options.status} Refused\r\n\r\n`);
      return;
    }
    const { host, port } = splitHostPort(target);
    const upstream = connect(port, host, () => {
      client.write(`HTTP/1.1 200 Connection Established\r\n\r\n${options.earlyData ?? ""}`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(sockets, upstream);
    upstream.on("error", () => client.destroy());
  });
  return { port: await listen(server), targets, authHeaders, close: () => shut(server, sockets) };
}

type SocksTarget = { type: "ipv4" | "ipv6" | "domain"; host: string; port: number };

/** A minimal SOCKS5 proxy (RFC 1928, RFC 1929); domain targets connect to 127.0.0.1. */
export async function startSocks5Proxy(
  options: {
    auth?: { username: string; password: string };
    reply?: number;
    splitReply?: boolean;
    silent?: boolean;
  } = {},
): Promise<Closable & { targets: SocksTarget[] }> {
  const targets: SocksTarget[] = [];
  const sockets = new Set<Socket>();
  const server = createNetServer((client) => {
    track(sockets, client);
    if (options.silent) return;
    let buffer = Buffer.alloc(0);
    let stage: "greeting" | "auth" | "request" = "greeting";
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting") {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
        const methods = [...buffer.subarray(2, 2 + buffer[1]!)];
        buffer = buffer.subarray(2 + buffer[1]!);
        if (options.auth && !methods.includes(2)) {
          client.end(Buffer.from([5, 0xff]));
          return;
        }
        client.write(Buffer.from([5, options.auth ? 2 : 0]));
        stage = options.auth ? "auth" : "request";
      }
      if (stage === "auth") {
        const userLength = buffer[1];
        if (userLength === undefined || buffer.length < 3 + userLength) return;
        const passLength = buffer[2 + userLength]!;
        if (buffer.length < 3 + userLength + passLength) return;
        const user = buffer.subarray(2, 2 + userLength).toString();
        const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString();
        buffer = buffer.subarray(3 + userLength + passLength);
        const ok = user === options.auth?.username && pass === options.auth?.password;
        client.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) {
          client.end();
          return;
        }
        stage = "request";
      }
      if (stage !== "request" || buffer.length < 5) return;
      const atyp = buffer[3];
      let target: SocksTarget;
      let end: number;
      if (atyp === 1) {
        end = 8;
        if (buffer.length < end + 2) return;
        target = { type: "ipv4", host: [...buffer.subarray(4, 8)].join("."), port: buffer.readUInt16BE(end) };
      } else if (atyp === 4) {
        end = 20;
        if (buffer.length < end + 2) return;
        const host = ipaddr.fromByteArray([...buffer.subarray(4, 20)]).toString();
        target = { type: "ipv6", host, port: buffer.readUInt16BE(end) };
      } else {
        end = 5 + buffer[4]!;
        if (buffer.length < end + 2) return;
        target = { type: "domain", host: buffer.subarray(5, end).toString(), port: buffer.readUInt16BE(end) };
      }
      buffer = buffer.subarray(end + 2);
      targets.push(target);
      client.off("data", onData);
      client.pause();
      if (options.reply !== undefined) {
        client.end(Buffer.from([5, options.reply, 0, 1, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const upstream = connect(target.port, target.type === "domain" ? "127.0.0.1" : target.host, () => {
        const reply = Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]);
        const pipeBoth = () => {
          if (buffer.length > 0) upstream.write(buffer);
          upstream.pipe(client);
          client.pipe(upstream);
        };
        if (!options.splitReply) {
          client.write(reply);
          pipeBoth();
          return;
        }
        client.write(reply.subarray(0, 3));
        setTimeout(() => {
          client.write(reply.subarray(3));
          pipeBoth();
        }, 20);
      });
      track(sockets, upstream);
      upstream.on("error", () => client.destroy());
    };
    client.on("data", onData);
  });
  return { port: await listen(server), targets, close: () => shut(server, sockets) };
}

function splitHostPort(value: string): { host: string; port: number } {
  const colon = value.lastIndexOf(":");
  const host = value.slice(0, colon).replace(/^\[|\]$/g, "");
  return { host, port: Number(value.slice(colon + 1)) };
}

function track(sockets: Set<Socket>, socket: Socket): void {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
}

async function listen(server: Server | HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function shut(server: Server | HttpServer, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}
