import { describe, expect, it } from "vitest";
import { installWebSocket } from "../src/client/websocket.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

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
