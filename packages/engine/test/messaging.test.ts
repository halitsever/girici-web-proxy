import { describe, expect, it } from "vitest";
import type { Invoke } from "../src/client/invoke.ts";
import { createMessageSender, installMessaging, post, type Send } from "../src/client/messaging.ts";
import { installToStringMask } from "../src/client/native-mask.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import type { WindowGuard } from "../src/client/windows.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";
import { spyBuiltins } from "./spied-builtins.ts";

describe("post", () => {
  it("delivers a message for the sender's own origin ('/') only to a window of that origin", () => {
    const sent: unknown[][] = [];
    const send = (...args: unknown[]) => sent.push(args);
    post(send, "https://a.test", "http://proxy.test", "same", "/", [], "https://a.test");
    post(send, "https://b.test", "http://proxy.test", "other", "/", [], "https://a.test");
    expect(sent).toEqual([["same", "http://proxy.test"]]);
  });

  it("passes options on with their own fields only, so the native reads nothing from the page's Object.prototype", async () => {
    const delivered: unknown[] = [0];
    // Reads what the native dictionary conversion reads.
    const send = (_message: unknown, options: { targetOrigin?: unknown; transfer?: unknown }) => {
      void options.transfer;
      delivered[0] = options;
    };
    const options = { targetOrigin: "*", note: "s3cr3t" };
    const seen = await spyBuiltins("s3cr3t", () => {
      post(send as Send, "https://a.test", "http://proxy.test", "hi", options, [], "https://a.test");
    });
    expect(seen).toEqual([]);
    expect(delivered[0]).toEqual({ targetOrigin: "*", note: "s3cr3t" });
    expect(Object.getPrototypeOf(delivered[0])).toBeNull();
  });
});

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

  it("masks its event getters as the natives they replace", () => {
    const proto = {
      get source() {
        return null;
      },
      get origin() {
        return "";
      },
    };
    const natives = ["source", "origin"].map((name) => Object.getOwnPropertyDescriptor(proto, name)?.get);
    const win = { ...fakeMessagingWin([], "http://proxy.test"), MessageEvent: { prototype: proto } } as Realm;
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct, asIs);
    const fake = { Function: { prototype: { toString: Function.prototype.toString } } } as unknown as Realm;
    installToStringMask(fake);
    const masked = fake.Function.prototype.toString;
    const hooked = ["source", "origin"].map((name) => Object.getOwnPropertyDescriptor(proto, name)?.get);
    expect(hooked).not.toEqual(natives);
    expect(hooked.map((get) => Reflect.apply(masked, get, []))).toEqual(
      natives.map((get) => Function.prototype.toString.call(get)),
    );
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
  it("addresses a window by its real origin, not the origin its page claims", () => {
    const calls: unknown[][] = [];
    const win = {
      postMessage(this: unknown, ...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as Realm;
    const sender = createMessageSender(win, ctxFor("https://site-a.test", "http://proxy.test"), direct);
    const target = fakeWindow("https://site-b.test");
    target.origin = "https://site-c.test";
    const standIn = sender(target) as { postMessage(...args: unknown[]): void };
    standIn.postMessage("to c", "https://site-c.test");
    standIn.postMessage("to b", "https://site-b.test");
    expect(calls).toEqual([["to b", "http://proxy.test"]]);
  });

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
