import { describe, expect, it } from "vitest";
import type { Invoke } from "../src/client/invoke.ts";
import { createMessageSender, installMessaging } from "../src/client/messaging.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

const direct: Invoke = (fn, self, args) => Reflect.apply(fn, self, args);

function ctxFor(realOrigin: string, proxyOrigin: string): UrlContext {
  return { origin: proxyOrigin, realUrl: () => new URL(`${realOrigin}/`) } as unknown as UrlContext;
}

function fakeMessagingWin(calls: unknown[][], proxyOrigin: string): Realm {
  return {
    postMessage(...args: unknown[]) {
      calls.push(args);
    },
    location: { origin: proxyOrigin },
    MessageEvent: { prototype: {} },
  } as unknown as Realm;
}

/** A same-origin window as another realm sees it; its runtime masks origin to the real one. */
function fakeWindow(origin: string): Record<string, unknown> {
  const win: Record<string, unknown> = { origin };
  win.window = win;
  return win;
}

describe("installMessaging", () => {
  it("delivers to a matching target origin, drops a mismatch and keeps the wildcard", () => {
    const calls: unknown[][] = [];
    const win = fakeMessagingWin(calls, "http://proxy.test");
    // The receiver's real origin is site-a, so only a message addressed to site-a is delivered.
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct);
    win.postMessage("self", "https://site-a.test");
    win.postMessage("other", "https://site-b.test");
    win.postMessage("w", "*");
    expect(calls).toEqual([
      ["self", "http://proxy.test"],
      ["w", "*"],
    ]);
  });

  it("reports the sender's real origin, as its own runtime gives it", () => {
    const proto = {
      get origin() {
        return (this as unknown as { nativeOrigin: string }).nativeOrigin;
      },
    };
    const win = { ...fakeMessagingWin([], "http://proxy.test"), MessageEvent: { prototype: proto } } as Realm;
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct);
    const event = (source: unknown, nativeOrigin: string) =>
      Object.assign(Object.create(proto) as { origin: string }, { source, nativeOrigin });

    expect(event(fakeWindow("https://site-b.test"), "http://proxy.test").origin).toBe("https://site-b.test");
    // Ports and workers have no window behind them.
    expect(event(null, "").origin).toBe("");
    expect(event(fakeWindow("https://elsewhere.test"), "https://elsewhere.test").origin).toBe("https://elsewhere.test");
  });

  it("sends through the invoker", () => {
    const win = fakeMessagingWin([], "http://proxy.test");
    const invoked: Array<{ self: unknown; args: readonly unknown[] }> = [];
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), (_fn, self, args) => {
      invoked.push({ self, args });
    });
    win.postMessage("m", "https://site-a.test");
    expect(invoked).toEqual([{ self: win, args: ["m", "http://proxy.test"] }]);
  });
});

describe("createMessageSender", () => {
  it("posts to another window from this realm, translating the target origin", () => {
    const calls: unknown[][] = [];
    const win = {
      postMessage(this: unknown, ...args: unknown[]) {
        calls.push([this, ...args]);
      },
    } as unknown as Realm;
    const sender = createMessageSender(win, ctxFor("https://site-a.test", "http://proxy.test"), direct);
    const target = fakeWindow("https://site-b.test");
    const port = {};
    const standIn = sender(target) as { postMessage(...args: unknown[]): void };

    standIn.postMessage("hi", "https://site-b.test:443", [port]);
    standIn.postMessage("other", "https://site-c.test");
    standIn.postMessage("w", "*");
    standIn.postMessage("o", { targetOrigin: "https://site-b.test", transfer: [port] });
    expect(calls).toEqual([
      [target, "hi", "http://proxy.test", [port]],
      [target, "w", "*"],
      [target, "o", { targetOrigin: "http://proxy.test", transfer: [port] }],
    ]);
  });

  it("returns ports, workers and cross-origin windows untouched", () => {
    const sender = createMessageSender(
      { postMessage() {} } as unknown as Realm,
      ctxFor("https://a.test", "http://p.test"),
      direct,
    );
    const port = { postMessage() {} };
    const crossOrigin: Record<string, unknown> = {};
    crossOrigin.window = crossOrigin;
    Object.defineProperty(crossOrigin, "origin", {
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(sender(port)).toBe(port);
    expect(sender(null)).toBe(null);
    expect(sender(undefined)).toBe(undefined);
    expect(sender(crossOrigin)).toBe(crossOrigin);
  });

  it("sends through the invoker", () => {
    const native = () => {};
    const invoked: Array<{ fn: unknown; self: unknown; args: readonly unknown[] }> = [];
    const sender = createMessageSender(
      { postMessage: native } as unknown as Realm,
      ctxFor("https://site-a.test", "http://proxy.test"),
      (fn, self, args) => {
        invoked.push({ fn, self, args });
      },
    );
    const target = fakeWindow("https://site-b.test");
    (sender(target) as { postMessage(...args: unknown[]): void }).postMessage("m", "https://site-b.test");
    expect(invoked).toEqual([{ fn: native, self: target, args: ["m", "http://proxy.test"] }]);
  });
});
