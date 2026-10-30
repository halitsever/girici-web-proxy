import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { createLogger } from "../src/log.ts";
import { compileTrust } from "../src/http/client-ip.ts";
import { tokenBucket } from "../src/http/rate-limit.ts";
import { createTunnelDialer } from "../src/upstream/agent.ts";
import { HostBlocklist } from "../src/upstream/blocklist.ts";
import { SsrfBlockedError } from "../src/upstream/ssrf.ts";
import {
  attachWsRelay,
  mapCloseCode,
  PerClientCount,
  tlsIdentity,
  validateWsTarget,
  type WsRelayOptions,
} from "../src/ws/relay-ws.ts";
import { sealWsHandshake } from "../src/ws/seal.ts";
import { httpProxy, startConnectProxy, startSilent } from "./helpers/proxies.ts";

const policy = { allowedTestHosts: new Set<string>() };
const noopLookup = ((_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) =>
  cb(null, "127.0.0.1", 4)) as never;
const logger = createLogger("error", () => {});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
});

function echoUpstream(): Promise<number> {
  const wss = new WebSocketServer({ port: 0 });
  cleanups.push(() => wss.close());
  wss.on("headers", (headers) => headers.push("set-cookie: up=1"));
  wss.on("connection", (socket) => socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary })));
  return new Promise((resolve) => wss.on("listening", () => resolve((wss.address() as AddressInfo).port)));
}

async function countingEchoUpstream(): Promise<{ port: number; connections(): number }> {
  let count = 0;
  const wss = new WebSocketServer({ port: 0 });
  cleanups.push(() => wss.close());
  wss.on("connection", (socket) => {
    count++;
    socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  const port = await new Promise<number>((resolve) =>
    wss.on("listening", () => resolve((wss.address() as AddressInfo).port)),
  );
  return { port, connections: () => count };
}

async function relayServer(upstreamPort: number, options: Partial<WsRelayOptions> = {}): Promise<string> {
  const server: Server = createServer();
  cleanups.push(() => server.close());
  attachWsRelay(server, {
    allowedTestHosts: new Set(["ws.test"]),
    lookup: noopLookup,
    logger,
    // A tunnel exercises the real dial, which reaches the upstream through the proxy.
    dial: options.tunnel
      ? undefined
      : (_target, init) => new WebSocket(`ws://127.0.0.1:${upstreamPort}/`, init.protocols),
    ...options,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/_g/ws`;
}

function connect(url: string, origin: string, cookie?: string, xff?: string): WebSocket {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  if (xff) headers["x-forwarded-for"] = xff;
  const ws = new WebSocket(url, ["girici.v1"], { headers });
  cleanups.push(() => ws.close());
  return ws;
}

const originOf = (url: string) => url.replace("ws://", "http://").replace("/_g/ws", "");

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`refused with ${res.statusCode}`)));
    setTimeout(() => reject(new Error("did not open")), 3000);
  });
}

function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    setTimeout(() => reject(new Error("no close")), 3000);
  });
}

function openMessage(ws: WebSocket): Promise<{ t?: string }> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString()) as { t?: string }));
    setTimeout(() => reject(new Error("no open message")), 3000);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data: Buffer) => resolve(data.toString()));
    setTimeout(() => reject(new Error("no message")), 3000);
  });
}

function refusal(ws: WebSocket): Promise<number> {
  // Closing a refused socket during cleanup aborts its handshake, which ws reports as an error.
  ws.on("error", () => {});
  return new Promise((resolve, reject) => {
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => reject(new Error("opened despite the limit")));
    setTimeout(() => reject(new Error("no refusal")), 3000);
  });
}

describe("mapCloseCode", () => {
  it("passes normal and application codes through", () => {
    expect(mapCloseCode(1000)).toBe(1000);
    expect(mapCloseCode(3000)).toBe(3000);
  });

  it("remaps the codes the browser forbids in close()", () => {
    expect(mapCloseCode(1005)).toBe(1000);
    expect(mapCloseCode(1006)).toBe(1011);
    expect(mapCloseCode(1015)).toBe(1011);
  });
});

describe("tlsIdentity", () => {
  it("checks a wss certificate against the target, also for IP literals", () => {
    expect(tlsIdentity(new URL("wss://chat.example/s"))).toEqual({ host: "chat.example", servername: "chat.example" });
    expect(tlsIdentity(new URL("wss://[2606:4700::1111]/s"))).toEqual({ host: "2606:4700::1111" });
    expect(tlsIdentity(new URL("wss://203.0.113.7/s"))).toEqual({ host: "203.0.113.7" });
  });
});

describe("validateWsTarget", () => {
  it("accepts ws and wss on allowed ports", () => {
    expect(() => validateWsTarget(new URL("ws://example.com/socket"), policy)).not.toThrow();
    expect(() => validateWsTarget(new URL("wss://example.com/socket"), policy)).not.toThrow();
    expect(() => validateWsTarget(new URL("wss://example.com:8443/"), policy)).not.toThrow();
  });

  it("rejects non-ws schemes", () => {
    expect(() => validateWsTarget(new URL("https://example.com/"), policy)).toThrow(SsrfBlockedError);
  });

  it("rejects a non-public host and a disallowed port", () => {
    expect(() => validateWsTarget(new URL("wss://127.0.0.1/"), policy)).toThrow(SsrfBlockedError);
    expect(() => validateWsTarget(new URL("ws://example.com:3000/"), policy)).toThrow(SsrfBlockedError);
  });
});

describe("ws relay (integration)", () => {
  it("rejects an upgrade whose Origin is not ours", async () => {
    const url = await relayServer(await echoUpstream());
    const client = connect(url, "http://evil.test");
    await new Promise<void>((resolve, reject) => {
      client.on("error", () => resolve());
      client.on("open", () => reject(new Error("opened despite a foreign Origin")));
      setTimeout(() => reject(new Error("no rejection")), 3000);
    });
  });

  it("rejects an unauthenticated upgrade when an auth store gates it", async () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    const url = await relayServer(await echoUpstream(), { authStore: store });
    const origin = url.replace("ws://", "http://").replace("/_g/ws", "");
    const client = connect(url, origin);
    await new Promise<void>((resolve, reject) => {
      client.on("error", () => resolve());
      client.on("open", () => reject(new Error("opened without a session")));
      setTimeout(() => reject(new Error("no rejection")), 3000);
    });
  });

  it("accepts an upgrade with a valid session cookie", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    const url = await relayServer(await echoUpstream(), { authStore: store });
    const origin = url.replace("ws://", "http://").replace("/_g/ws", "");
    const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
    const client = connect(url, origin, cookie);
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => resolve());
      client.on("error", (e) => reject(e));
      setTimeout(() => reject(new Error("did not open")), 3000);
    });
  });

  it("relays text and binary frames and forwards the upstream Set-Cookie", async () => {
    const url = await relayServer(await echoUpstream());
    const client = connect(url, url.replace("ws://", "http://").replace("/_g/ws", ""));
    const got: Array<{ t?: string; sc?: string[]; text?: string; bin?: number[] }> = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${JSON.stringify(got)}`)), 6000);
      client.on("error", reject);
      client.on("open", () => client.send(JSON.stringify({ u: "ws://ws.test/", p: [] })));
      client.on("message", (data: Buffer, isBinary: boolean) => {
        const text = isBinary ? "" : data.toString();
        if (text.startsWith("{")) {
          got.push(JSON.parse(text) as { t: string; sc: string[] });
          client.send("hello");
          client.send(Buffer.from([1, 2, 3]));
        } else {
          got.push(isBinary ? { bin: [...data] } : { text });
        }
        if (got.length >= 3) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(got[0]?.t).toBe("open");
    expect(got[0]?.sc).toContain("up=1");
    expect(got).toContainEqual({ text: "hello" });
    expect(got).toContainEqual({ bin: [1, 2, 3] });
  });

  it("closes the client when the control frame names a blocked target", async () => {
    const url = await relayServer(await echoUpstream());
    const client = connect(url, url.replace("ws://", "http://").replace("/_g/ws", ""));
    const code = await new Promise<number>((resolve, reject) => {
      client.on("open", () => client.send(JSON.stringify({ u: "wss://10.0.0.1/" })));
      client.on("close", (c) => resolve(c));
      client.on("message", () => reject(new Error("blocked target should not relay")));
      setTimeout(() => reject(new Error("no close")), 3000);
    });
    expect(code).toBe(1011);
  });

  it("answers an upgrade over the limit with 429", async () => {
    const url = await relayServer(await echoUpstream(), { limiter: tokenBucket({ perMinute: 1 }) });
    await opened(connect(url, originOf(url)));
    expect(await refusal(connect(url, originOf(url)))).toBe(429);
  });

  it("caps WebSockets per forwarded client address, not per socket", async () => {
    const url = await relayServer(await echoUpstream(), { trust: compileTrust(1), maxPerIp: 1 });
    await opened(connect(url, originOf(url), undefined, "203.0.113.1"));
    await opened(connect(url, originOf(url), undefined, "203.0.113.2"));
    expect(await refusal(connect(url, originOf(url), undefined, "203.0.113.1"))).toBe(429);
  });
  it("closes with 1008 when the control frame names a blocked host", async () => {
    const upstream = await countingEchoUpstream();
    const url = await relayServer(upstream.port, { blocklist: new HostBlocklist(["ws.test"], []) });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect(await closed(ws)).toEqual({ code: 1008, reason: "blocked" });
    expect(upstream.connections()).toBe(0);
  });
  it("dials the upstream through the proxy tunnel", async () => {
    const upstreamPort = await echoUpstream();
    const proxy = await startConnectProxy();
    cleanups.push(() => void proxy.close());
    const tunnel = createTunnelDialer(httpProxy(proxy.port), {
      lookup: noopLookup,
      testUpstreams: new Map([["ws.test", { host: "127.0.0.1", port: upstreamPort }]]),
      timeout: 2000,
    });
    const url = await relayServer(upstreamPort, { tunnel });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(ws)).t).toBe("open");
    ws.send("hi");
    expect(await nextMessage(ws)).toBe("hi");
    expect(proxy.targets).toEqual([`127.0.0.1:${upstreamPort}`]);
  });

  it("closes with 1011 when the proxy refuses the tunnel", async () => {
    const proxy = await startConnectProxy({ status: 407 });
    cleanups.push(() => void proxy.close());
    const tunnel = createTunnelDialer(httpProxy(proxy.port), {
      lookup: noopLookup,
      testUpstreams: new Map([["ws.test", { host: "127.0.0.1", port: 1 }]]),
      timeout: 2000,
    });
    const url = await relayServer(await echoUpstream(), { tunnel });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await closed(ws)).code).toBe(1011);
    expect(proxy.targets).toHaveLength(1);
  });
  it("times out a tunneled upstream that never answers the handshake", async () => {
    const silent = await startSilent();
    const proxy = await startConnectProxy();
    cleanups.push(
      () => void silent.close(),
      () => void proxy.close(),
    );
    const tunnel = createTunnelDialer(httpProxy(proxy.port), {
      lookup: noopLookup,
      testUpstreams: new Map([["ws.test", { host: "127.0.0.1", port: silent.port }]]),
      timeout: 2000,
    });
    const url = await relayServer(1, { tunnel, handshakeTimeoutMs: 300 });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await closed(ws)).code).toBe(1011);
  });
});

describe("sealed handshakes", () => {
  /** A public relay whose dial records the headers it would send upstream. */
  async function sealedRelay() {
    const store = new AuthStore(openDb(":memory:"));
    store.setPublicAccess(true);
    const port = await echoUpstream();
    const seen: { headers: Record<string, string> } = { headers: {} };
    const url = await relayServer(port, {
      authStore: store,
      dial: (_target, init) => {
        seen.headers = init.headers;
        return new WebSocket(`ws://127.0.0.1:${port}/`, init.protocols);
      },
    });
    const client = connect(url, originOf(url));
    await opened(client);
    return { store, client, seen };
  }

  it("sends only sealed cookies and Origin upstream", async () => {
    const { store, client, seen } = await sealedRelay();
    const seal = sealWsHandshake(store.sessionSecret(), {
      target: new URL("ws://ws.test/"),
      origin: "https://page.test",
      cookie: "sid=1",
    });
    client.send(JSON.stringify({ u: "ws://ws.test/", s: seal, c: "stolen=1", o: "https://evil.test" }));
    expect((await openMessage(client)).t).toBe("open");
    expect(seen.headers.cookie).toBe("sid=1");
    expect(seen.headers.origin).toBe("https://page.test");
  });

  it("connects without cookies when an old runtime sends them in clear", async () => {
    const { client, seen } = await sealedRelay();
    client.send(JSON.stringify({ u: "ws://ws.test/", c: "sid=1", o: "https://evil.test" }));
    expect((await openMessage(client)).t).toBe("open");
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers.origin).toBe("http://ws.test");
  });
});

describe("PerClientCount", () => {
  it("caps a client and forgets it once its last socket closes", () => {
    const count = new PerClientCount();
    expect(count.take("a", 2)).toBe(true);
    expect(count.take("a", 2)).toBe(true);
    expect(count.take("a", 2)).toBe(false);
    count.release("a");
    count.release("a");
    expect(count.size).toBe(0);
  });
});

describe("malformed control frames", () => {
  it("closes, instead of crashing, on a control frame with a malformed seal or protocol list", async () => {
    const frames = [
      { u: "ws://ws.test/", s: 1 },
      { u: "ws://ws.test/", s: {} },
      { u: "ws://ws.test/", s: true },
      { u: "ws://ws.test/", s: "x".repeat(5000) },
      { u: "ws://ws.test/", p: [1] },
    ];
    for (const frame of frames) {
      const store = new AuthStore(openDb(":memory:"));
      store.setPublicAccess(true);
      const url = await relayServer(await echoUpstream(), { authStore: store });
      const client = connect(url, originOf(url));
      await opened(client);
      client.send(JSON.stringify(frame));
      expect((await closed(client)).code, JSON.stringify(frame).slice(0, 40)).toBe(1008);
    }
  });
});
