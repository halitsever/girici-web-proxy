import { createServer, type Server } from "node:http";
import { connect as netConnect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { parseSiteDomain } from "@girici/engine/shared";
import { createSessionToken, createSiteSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { createLogger } from "../src/log.ts";
import { bandwidthUpgradeGate, ByteMeter, meterObserver } from "../src/http/bandwidth.ts";
import { compileTrust } from "../src/http/client-ip.ts";
import { tokenBucket } from "../src/http/rate-limit.ts";
import type { RelayObserver } from "../src/http/relay-observer.ts";
import { createTunnelDialer } from "../src/upstream/agent.ts";
import { HostBlocklist } from "../src/upstream/blocklist.ts";
import { SsrfBlockedError } from "../src/upstream/ssrf.ts";
import {
  attachWsRelay,
  mapCloseCode,
  PerClientCount,
  tlsIdentity,
  validateWsTarget,
  type UpgradeGate,
  type WsRelayHandle,
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
  return (await startRelay(upstreamPort, options)).url;
}

async function startRelay(
  upstreamPort: number,
  options: Partial<WsRelayOptions> = {},
): Promise<{ url: string; relay: WsRelayHandle }> {
  const server: Server = createServer();
  cleanups.push(() => server.close());
  const relay = attachWsRelay(server, {
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
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/_g/ws`, relay };
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

/** Sends a bare upgrade and reads whatever comes back until the server closes the socket. */
function rawUpgrade(url: string): Promise<string> {
  const { port } = new URL(url);
  const raw = netConnect(Number(port), "127.0.0.1");
  cleanups.push(() => raw.destroy());
  raw.write(
    [
      "GET /_g/ws HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      `Origin: http://127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Protocol: girici.v1",
      "",
      "",
    ].join("\r\n"),
  );
  return new Promise((resolve, reject) => {
    let text = "";
    raw.on("data", (chunk: Buffer) => (text += chunk.toString()));
    raw.on("close", () => resolve(text));
    raw.on("error", reject);
    setTimeout(() => reject(new Error(`no close after ${JSON.stringify(text)}`)), 3000);
  });
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** An observer that keeps everything it hears. */
function listening() {
  const answers: Array<[string, string | null]> = [];
  const bytes: Array<[string, number, string]> = [];
  let socketsClosed = 0;
  const observer: RelayObserver = {
    bytes: (key, count, direction) => bytes.push([key, count, direction]),
    answered: (kind, code) => answers.push([kind, code]),
    socketClosed: () => socketsClosed++,
  };
  return { observer, answers, bytes, socketsClosed: () => socketsClosed };
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

  it("accepts a site session on a site host and refuses upgrades on the root", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    const url = await relayServer(await echoUpstream(), {
      authStore: store,
      siteDomain: parseSiteDomain("proxy.test")!,
    });
    const cookie = `girici-site=${createSiteSessionToken(admin.id, store.sessionSecret())}`;
    const upgrade = (host: string) => {
      const ws = new WebSocket(url, ["girici.v1"], { headers: { host, origin: `http://${host}`, cookie } });
      cleanups.push(() => ws.close());
      return ws;
    };
    await opened(upgrade("k6wjalxihe6pja6woodbryo47k.proxy.test"));
    await expect(opened(upgrade("proxy.test"))).rejects.toThrow();
    await expect(opened(upgrade("127.0.0.1"))).rejects.toThrow();
  });

  it("relays text and binary frames and keeps the upstream Set-Cookie from the page", async () => {
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
    expect(got[0]).toEqual({ t: "open", p: "" });
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
  it("warns the operator once when the upstream proxy fails, without its credentials", async () => {
    const proxy = await startConnectProxy({ status: 407 });
    cleanups.push(() => void proxy.close());
    const tunnel = createTunnelDialer(
      { ...httpProxy(proxy.port), username: "user", password: "secret" },
      { lookup: noopLookup, testUpstreams: new Map([["ws.test", { host: "127.0.0.1", port: 1 }]]), timeout: 2000 },
    );
    const lines: string[] = [];
    const url = await relayServer(1, { tunnel, logger: createLogger("warn", (line) => lines.push(line)) });
    for (let i = 0; i < 2; i++) {
      const ws = connect(url, originOf(url));
      await opened(ws);
      ws.send(JSON.stringify({ u: "ws://ws.test/" }));
      expect((await closed(ws)).code).toBe(1011);
    }
    expect(lines.filter((line) => line.includes("Upstream proxy failed"))).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("secret");
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

describe("open-instance seams", () => {
  it("answers an upgrade with the first refusing gate's status and wait", async () => {
    const record: string[] = [];
    const { observer, answers } = listening();
    const gates: UpgradeGate[] = [
      (_req, key) => {
        record.push(`a:${key}`);
        return null;
      },
      () => {
        record.push("b");
        return { code: "quota", status: 429, retryAfter: 7 };
      },
      () => {
        record.push("c");
        return null;
      },
    ];
    const url = await relayServer(await echoUpstream(), { upgradeGates: gates, observer });
    const answer = await rawUpgrade(url);
    expect(answer).toMatch(/^HTTP\/1\.1 429 Too Many Requests\r\n/);
    expect(answer).toMatch(/\r\nRetry-After: 7\r\n/);
    expect(record).toEqual(["a:127.0.0.1", "b"]);
    expect(answers).toEqual([["ws", "quota"]]);
    const challenged = await relayServer(await echoUpstream(), {
      upgradeGates: [() => ({ code: "challenge", status: 403 })],
    });
    const refused = await rawUpgrade(challenged);
    expect(refused).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    expect(refused).not.toMatch(/Retry-After/);
  });

  it("closes a socket with 1008 once its client may not move more bytes, unless the admin opened it", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    store.setPublicAccess(true);
    let allowed = true;
    const url = await relayServer(await echoUpstream(), { authStore: store, allowFrame: () => allowed });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(ws)).t).toBe("open");
    ws.send("one");
    expect(await nextMessage(ws)).toBe("one");
    allowed = false;
    const late: string[] = [];
    ws.on("message", (data: Buffer) => late.push(data.toString()));
    const done = closed(ws);
    ws.send("two");
    expect(await done).toEqual({ code: 1008, reason: "quota" });
    expect(late).toEqual([]);

    const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
    const own = connect(url, originOf(url), cookie);
    await opened(own);
    own.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(own)).t).toBe("open");
    own.send("three");
    expect(await nextMessage(own)).toBe("three");
  });

  it("reports an opened socket, its bytes and its close", async () => {
    const { observer, answers, bytes, socketsClosed } = listening();
    const url = await relayServer(await echoUpstream(), { observer });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(ws)).t).toBe("open");
    ws.send("ping");
    expect(await nextMessage(ws)).toBe("ping");
    ws.close();
    await until(() => socketsClosed() === 1);
    expect(answers).toEqual([["ws", null]]);
    const total = (direction: string) =>
      bytes.filter(([key, , d]) => key === "127.0.0.1" && d === direction).reduce((sum, [, n]) => sum + n, 0);
    expect(total("up")).toBeGreaterThanOrEqual(4);
    expect(total("down")).toBeGreaterThanOrEqual(4);
  });

  it("reports every refused or failed socket with its code", async () => {
    const { observer, answers, socketsClosed } = listening();
    const port = await echoUpstream();
    const ask = async (url: string, frame: unknown) => {
      const ws = connect(url, originOf(url));
      await opened(ws);
      ws.send(JSON.stringify(frame));
      await closed(ws);
    };

    const plain = await relayServer(port, { observer, blocklist: new HostBlocklist(["blocked.test"], []) });
    const foreign = connect(plain, "http://evil.test");
    await new Promise<void>((resolve) => foreign.on("error", () => resolve()));
    await ask(plain, { u: "ws://blocked.test/" });
    await ask(plain, { u: "wss://10.0.0.1/" });
    await ask(plain, { p: [] });

    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    const gatedUrl = await relayServer(port, { observer, authStore: store });
    const gated = connect(gatedUrl, originOf(gatedUrl));
    await new Promise<void>((resolve) => gated.on("error", () => resolve()));

    const limited = await relayServer(port, { observer, limiter: tokenBucket({ perMinute: 1 }) });
    await opened(connect(limited, originOf(limited)));
    expect(await refusal(connect(limited, originOf(limited)))).toBe(429);

    const failing = await relayServer(port, {
      observer,
      dial: () => {
        throw Object.assign(new Error("no such host"), { code: "ENOTFOUND" });
      },
    });
    await ask(failing, { u: "ws://ws.test/" });

    expect(answers.map(([, code]) => code)).toEqual([
      "bad_request",
      "blocked",
      "ssrf_blocked",
      "bad_request",
      "auth",
      "rate_limited",
      "dns",
    ]);
    expect(answers.every(([kind]) => kind === "ws")).toBe(true);
    expect(socketsClosed()).toBe(0);
  });

  it("refuses an upgrade over the quota with 429, and closes an open socket that goes over with 1008", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    store.setPublicAccess(true);
    const meter = new ByteMeter({ perMinute: 64, perDay: 0 });
    const url = await relayServer(await echoUpstream(), {
      authStore: store,
      upgradeGates: [bandwidthUpgradeGate({ meter, store })],
      allowFrame: (key) => meter.check(key).ok,
      observer: meterObserver(meter),
    });
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(ws)).t).toBe("open");
    const late: string[] = [];
    ws.on("message", (data: Buffer) => late.push(data.toString()));
    const done = closed(ws);
    ws.send("x".repeat(100));
    expect(await done).toEqual({ code: 1008, reason: "quota" });
    expect(late).toEqual([]);

    const answer = await rawUpgrade(url);
    expect(answer).toMatch(/^HTTP\/1\.1 429 Too Many Requests\r\n/);
    expect(answer).toMatch(/\r\nRetry-After: [1-9]\d*\r\n/);

    const own = connect(url, originOf(url), `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`);
    await opened(own);
    own.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(own)).t).toBe("open");
    own.send("y".repeat(1000));
    expect(await nextMessage(own)).toBe("y".repeat(1000));
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

describe("shutdown", () => {
  it("closes open relays on both ends with 1001 and refuses new upgrades", async () => {
    const wss = new WebSocketServer({ port: 0 });
    cleanups.push(() => wss.close());
    const upstreamClosed = new Promise<number>((resolve) =>
      wss.on("connection", (socket) => socket.on("close", (code) => resolve(code))),
    );
    const port = await new Promise<number>((resolve) =>
      wss.on("listening", () => resolve((wss.address() as AddressInfo).port)),
    );
    const { url, relay } = await startRelay(port);
    const ws = connect(url, originOf(url));
    await opened(ws);
    ws.send(JSON.stringify({ u: "ws://ws.test/" }));
    expect((await openMessage(ws)).t).toBe("open");

    const done = relay.close();
    expect(await closed(ws)).toEqual({ code: 1001, reason: "server shutting down" });
    expect(await upstreamClosed).toBe(1001);
    await done;
    const late = connect(url, originOf(url));
    await expect(opened(late)).rejects.toThrow();
  });

  it("cuts a client that never answers the close frame once the grace period ends", async () => {
    const { url, relay } = await startRelay(await echoUpstream());
    const { port } = new URL(url);
    const raw = netConnect(Number(port), "127.0.0.1");
    cleanups.push(() => raw.destroy());
    raw.write(
      [
        "GET /_g/ws HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Origin: http://127.0.0.1:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Protocol: girici.v1",
        "",
        "",
      ].join("\r\n"),
    );
    await new Promise<void>((resolve) => raw.once("data", () => resolve()));
    const rawClosed = new Promise<void>((resolve) => raw.once("close", () => resolve()));
    const started = Date.now();
    await relay.close(200);
    await rawClosed;
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("resolves at once when nothing is open", async () => {
    const { relay } = await startRelay(await echoUpstream());
    await relay.close();
  });
});
