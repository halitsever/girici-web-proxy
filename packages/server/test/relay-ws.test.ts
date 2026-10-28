import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { createLogger } from "../src/log.ts";
import { SsrfBlockedError } from "../src/upstream/ssrf.ts";
import { attachWsRelay, mapCloseCode, validateWsTarget } from "../src/ws/relay-ws.ts";

const policy = { allowedTestHosts: new Set<string>() };
const noopLookup = ((_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, "127.0.0.1", 4)) as never;
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

async function relayServer(upstreamPort: number, authStore?: AuthStore): Promise<string> {
  const server: Server = createServer();
  cleanups.push(() => server.close());
  attachWsRelay(server, {
    allowedTestHosts: new Set(["ws.test"]),
    lookup: noopLookup,
    logger,
    authStore,
    dial: (_target, init) => new WebSocket(`ws://127.0.0.1:${upstreamPort}/`, init.protocols),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/_g/ws`;
}

function connect(url: string, origin: string, cookie?: string): WebSocket {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(url, ["girici.v1"], { headers });
  cleanups.push(() => ws.close());
  return ws;
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
    const url = await relayServer(await echoUpstream(), store);
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
    const url = await relayServer(await echoUpstream(), store);
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
});
