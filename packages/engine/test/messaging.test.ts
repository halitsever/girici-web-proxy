import { describe, expect, it } from "vitest";
import type { Invoke } from "../src/client/invoke.ts";
import { createMessageSender, installMessaging, post } from "../src/client/messaging.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import type { WindowGuard } from "../src/client/windows.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

describe("post with built-ins the page replaced", () => {
  const cases = () => {
    const sent: unknown[][] = [];
    const send = (...args: unknown[]) => sent.push(args);
    post(send, "https://a.test", "http://proxy.test", "to a", "https://a.test", []);
    post(send, "https://b.test", "http://proxy.test", "to b", "https://a.test", []);
    return sent;
  };
  const expected = cases();
  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`addresses messages by real origin when ${name} is replaced`, () => {
      expect(withReplaced(target, key, replacement, cases)).toEqual(expected);
    });
  }
});

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

const asIs: WindowGuard = { wrap: (value) => value, isWrapper: () => false, reset: () => {} };

/** A same-origin window as another realm sees it; its runtime masks origin to the real one. */
function fakeWindow(origin: string): Record<string, unknown> {
  const win: Record<string, unknown> = {
    origin,
    location: { href: "about:blank" },
    __g$: { realOrigin: () => origin },
  };
  win.window = win;
  return win;
}

describe("installMessaging", () => {
  it("delivers to a matching target origin, drops a mismatch and keeps the wildcard", () => {
    const calls: unknown[][] = [];
    const win = fakeMessagingWin(calls, "http://proxy.test");
    // The receiver's real origin is site-a, so only a message addressed to site-a is delivered.
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct, asIs);
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
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct, asIs);
    const event = (source: unknown, nativeOrigin: string) =>
      Object.assign(Object.create(proto) as { origin: string }, { source, nativeOrigin });

    expect(event(fakeWindow("https://site-b.test"), "http://proxy.test").origin).toBe("https://site-b.test");
    // Ports and workers have no window behind them.
    expect(event(null, "").origin).toBe("");
    expect(event(fakeWindow("https://elsewhere.test"), "https://elsewhere.test").origin).toBe("https://elsewhere.test");
  });

  it("hands out the sender through the guard and reads its origin from the sender itself", () => {
    const proto = {
      get source() {
        return (this as unknown as { nativeSource: unknown }).nativeSource;
      },
      get origin() {
        return "http://proxy.test";
      },
    };
    const win = { ...fakeMessagingWin([], "http://proxy.test"), MessageEvent: { prototype: proto } } as Realm;
    const wrapped = { restricted: true };
    const guard: WindowGuard = { wrap: () => wrapped, isWrapper: (value) => value === wrapped, reset: () => {} };
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct, guard);
    const sender = fakeWindow("https://site-b.test");
    // A page can redefine its own origin; its address cannot be.
    sender.origin = "https://site-a.test";
    sender.location = { href: "http://proxy.test/~/https/site-b.test/x" };
    const event = Object.assign(Object.create(proto) as MessageEvent, { nativeSource: sender });
    expect(event.source).toBe(wrapped);
    expect(event.origin).toBe("https://site-b.test");
  });

  it("sends through the invoker", () => {
    const win = fakeMessagingWin([], "http://proxy.test");
    const invoked: Array<{ self: unknown; args: readonly unknown[] }> = [];
    installMessaging(
      win,
      ctxFor("https://site-a.test", "http://proxy.test"),
      (_fn, self, args) => {
        invoked.push({ self, args });
      },
      asIs,
    );
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

  it("returns restricted windows as they are, since their postMessage translates already", () => {
    const wrapper = fakeWindow("https://site-b.test");
    const sender = createMessageSender(
      { postMessage() {} } as unknown as Realm,
      ctxFor("https://a.test", "http://p.test"),
      direct,
      (value) => value === wrapper,
    );
    expect(sender(wrapper)).toBe(wrapper);
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
