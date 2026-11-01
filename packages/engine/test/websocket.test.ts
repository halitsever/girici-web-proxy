import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installWebSocket, type WebSocketRealm } from "../src/client/websocket.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class MockWs {
  static instances: MockWs[] = [];
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed: { code?: number; reason?: string } | null = null;
  readonly url: string;
  readonly protocols?: string | string[];
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWs.instances.push(this);
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

class TestCloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
    super(type);
    this.code = init.code ?? 0;
    this.reason = init.reason ?? "";
    this.wasClean = init.wasClean ?? false;
  }
}

function makeWin(prep: unknown = { seal: "S" }): Realm {
  return {
    WebSocket: MockWs as unknown,
    fetch: async () => ({ ok: true, json: async () => prep }),
    EventTarget,
    Event,
    MessageEvent,
    CloseEvent: TestCloseEvent,
    Blob,
  } as unknown as Realm;
}

const ctx = {
  origin: "http://localhost:3000",
  realUrl: () => new URL("https://discord.com/channels/@me"),
  realBase: () => new URL("https://discord.com/channels/@me"),
  toProxy: (raw: string) => raw,
  fromProxy: (value: string) => value,
} as unknown as UrlContext;

describe("installWebSocket", () => {
  it("connects to the relay while url reads the real target, and is an instanceof the shim", async () => {
    const win = makeWin();
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const ws = new win.WebSocket("wss://gateway.discord.gg/?v=10");
    expect(ws instanceof win.WebSocket).toBe(true);
    expect(ws.url).toBe("wss://gateway.discord.gg/?v=10");
    await flush();
    const inner = MockWs.instances[0]!;
    expect(inner.url).toBe("ws://localhost:3000/_g/ws");
    expect(inner.protocols).toEqual(["girici.v1"]);
  });

  it("installs on a worker scope's globals, without a window", async () => {
    const realm: WebSocketRealm = {
      WebSocket: MockWs as unknown as typeof WebSocket,
      fetch: (async () => ({ ok: true, json: async () => ({ seal: "S" }) })) as unknown as typeof fetch,
      EventTarget,
      Event,
      MessageEvent,
      CloseEvent: TestCloseEvent as unknown as typeof CloseEvent,
      Blob,
    };
    installWebSocket(realm, { origin: ctx.origin, realUrl: ctx.realUrl });
    MockWs.instances.length = 0;
    new realm.WebSocket("wss://gateway.discord.gg/");
    await flush();
    expect(MockWs.instances[0]?.url).toBe("ws://localhost:3000/_g/ws");
  });

  it("asks for the seal at an absolute URL", async () => {
    const urls: unknown[] = [];
    const win = makeWin();
    (win as unknown as { fetch: unknown }).fetch = async (url: unknown) => {
      urls.push(url);
      return { ok: true, json: async () => ({ seal: "S" }) };
    };
    installWebSocket(win, ctx);
    new win.WebSocket("wss://gateway.discord.gg/");
    await flush();
    expect(urls[0]).toBe(`${ctx.origin}/_g/rpc/ws-prep`);
  });

  it("opens only after the server control frame, then delivers text and binary by binaryType", async () => {
    const win = makeWin();
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const ws = new win.WebSocket("wss://gateway.discord.gg/");
    const events: string[] = [];
    ws.onopen = () => events.push("open");
    const messages: unknown[] = [];
    ws.onmessage = (event: MessageEvent) => messages.push(event.data);
    await flush();
    const inner = MockWs.instances[0]!;

    inner.onopen!();
    expect(JSON.parse(inner.sent[0] as string)).toEqual({ u: "wss://gateway.discord.gg/", p: [], s: "S" });
    expect(events).toEqual([]);
    expect(ws.readyState).toBe(0);

    inner.onmessage!({ data: JSON.stringify({ t: "open", p: "" }) });
    expect(events).toEqual(["open"]);
    expect(ws.readyState).toBe(1);

    inner.onmessage!({ data: "hello" });
    inner.onmessage!({ data: new ArrayBuffer(3) });
    expect(messages[0]).toBe("hello");
    expect(messages[1]).toBeInstanceOf(Blob);
  });

  it("reads the control frame with natives taken at load and its own fields only", async () => {
    const win = makeWin();
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const states: number[] = [];
    for (const [frame, run] of [
      ['{"x":1}', (go: () => void) => withPrototypeAdditions({ t: { value: "open", writable: true } }, go)],
      ['{"t":"open"}', (go: () => void) => withReplaced(JSON, "parse", { value: () => ({ t: "closed" }) }, go)],
    ] as const) {
      const ws = new win.WebSocket("wss://gateway.discord.gg/");
      await flush();
      const inner = MockWs.instances[MockWs.instances.length - 1]!;
      inner.onopen!();
      run(() => inner.onmessage!({ data: frame }));
      states.push(ws.readyState);
    }
    expect(states).toEqual([0, 1]);
  });

  it("builds its relay messages with natives taken at load, so the page never sees the seal", async () => {
    const win = makeWin({ seal: "S" });
    const seen: unknown[] = [];
    const nativeStringify = JSON.stringify;
    withReplaced(String.prototype, "replace", { value: () => "ws://evil.test" }, () => installWebSocket(win, ctx));
    MockWs.instances.length = 0;
    const record = {
      value: (...args: unknown[]) => {
        seen.push(args[0]);
        return Reflect.apply(nativeStringify, JSON, args);
      },
    };
    const proto = Object.prototype as Record<string, unknown>;
    // Kept across the awaits, which a synchronous helper would end early.
    Object.defineProperty(JSON, "stringify", { ...record, configurable: true, writable: true });
    proto.toJSON = () => "forged";
    let inner: MockWs;
    try {
      new win.WebSocket("wss://gateway.discord.gg/", ["a", "b"]);
      await flush();
      inner = MockWs.instances[0]!;
      inner.onopen!();
    } finally {
      JSON.stringify = nativeStringify;
      delete proto.toJSON;
    }
    expect(seen).toEqual([]);
    expect(inner.url).toBe("ws://localhost:3000/_g/ws");
    expect(JSON.parse(inner.sent[0] as string)).toEqual({ u: "wss://gateway.discord.gg/", p: ["a", "b"], s: "S" });
  });

  it("takes the seal only from the answer's own field", async () => {
    const win = makeWin({});
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const proto = Object.prototype as Record<string, unknown>;
    proto.seal = "forged";
    try {
      new win.WebSocket("wss://gateway.discord.gg/");
      await flush();
    } finally {
      delete proto.seal;
    }
    const inner = MockWs.instances[0]!;
    inner.onopen!();
    expect(JSON.parse(inner.sent[0] as string)).toMatchObject({ s: null });
  });

  it("delivers binary data from another realm as a Blob, as an adopted frame's socket does", async () => {
    const win = makeWin();
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const ws = new win.WebSocket("wss://gateway.discord.gg/");
    const messages: unknown[] = [];
    ws.onmessage = (event: MessageEvent) => messages.push(event.data);
    await flush();
    const inner = MockWs.instances[0]!;
    inner.onopen!();
    inner.onmessage!({ data: JSON.stringify({ t: "open", p: "" }) });
    inner.onmessage!({ data: runInNewContext("new ArrayBuffer(3)") as ArrayBuffer });
    expect(messages[0]).toBeInstanceOf(Blob);
  });

  it("maps a forbidden upstream close code and never throws on close()", async () => {
    const win = makeWin();
    installWebSocket(win, ctx);
    MockWs.instances.length = 0;
    const ws = new win.WebSocket("wss://gateway.discord.gg/");
    let closed: CloseEvent | null = null;
    ws.onclose = (event: CloseEvent) => (closed = event);
    await flush();
    const inner = MockWs.instances[0]!;
    inner.onopen!();
    inner.onmessage!({ data: JSON.stringify({ t: "open" }) });

    expect(() => ws.close(1006)).not.toThrow();
    inner.onclose!({ code: 1006, reason: "", wasClean: false });
    expect(closed!.code).toBe(1011);
  });
});
