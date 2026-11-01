import { describe, expect, it, vi } from "vitest";
import type { Invoke } from "../src/client/invoke.ts";
import {
  createCrossSitePoster,
  createMessageSender,
  CROSS_SITE_TIMEOUT_MS,
  installMessaging,
  post,
} from "../src/client/messaging.ts";
import { installToStringMask } from "../src/client/native-mask.ts";
import { createSiteLabels, type SiteLabels } from "../src/client/site-labels.ts";
import { createSiteMessaging } from "../src/client/site-messages.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import type { WindowGuard } from "../src/client/windows.ts";
import type { MessageEnvelope, SiteContext } from "../src/shared/protocol.ts";
import { toBase64Url } from "../src/shared/seal-cipher.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

describe("post", () => {
  it("delivers a message for the sender's own origin ('/') only to a window of that origin", () => {
    const sent: unknown[][] = [];
    const send = (...args: unknown[]) => sent.push(args);
    post(send, "https://a.test", "http://proxy.test", "same", "/", [], "https://a.test");
    post(send, "https://b.test", "http://proxy.test", "other", "/", [], "https://a.test");
    expect(sent).toEqual([["same", "http://proxy.test"]]);
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

const siteKey = new Uint8Array(32).fill(7);
const SITES: SiteContext = {
  domain: "proxy.test",
  root: "https://proxy.test",
  label: "k6wjalxihe6pja6woodbryo47k",
  key: toBase64Url(siteKey),
  site: "https://site-a.test",
  toolbar: true,
  engine: "DuckDuckGo",
};
const HOST_A = "https://k6wjalxihe6pja6woodbryo47k.proxy.test";
const HOST_B = "https://g4fjzasx42nioynauh4u6ncvdg.proxy.test";
const fromB = (fields: Record<string, unknown> = {}) => ({
  "\u0000girici": 1,
  o: "https://www.site-b.test",
  s: "https://site-b.test",
  t: "*",
  d: 5,
  ...fields,
});

/** Labels for a site-a page whose lookups `answer` settles. */
function siteLabels(answer: (origin: string) => Promise<string | null> = async () => HOST_B): SiteLabels {
  return createSiteLabels(
    SITES,
    () => "https://site-a.test",
    async (origins) => {
      const host = await answer(origins[0] as string);
      return [[origins[0] as string, host]];
    },
  );
}

function posterFor(labels: SiteLabels, setTimer: typeof setTimeout = setTimeout) {
  const sent: unknown[][] = [];
  const native = function (this: unknown, ...args: unknown[]) {
    sent.push([this, ...args]);
  };
  return { sent, post: createCrossSitePoster(labels, direct, native as Window["postMessage"], setTimer) };
}

describe("createCrossSitePoster", () => {
  const popup = { name: "popup" };
  const fromA = (t: string, d: unknown) => fromB({ o: "https://site-a.test", s: "https://site-a.test", t, d });

  it("delivers to another site's window at its host, in call order", async () => {
    const { sent, post } = posterFor(siteLabels(async () => HOST_B));
    post(popup, "first", "https://site-b.test", []);
    post(popup, "second", "*", []);
    expect(sent).toEqual([]);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      [popup, fromA("https://site-b.test", "first"), HOST_B],
      [popup, fromA("*", "second"), "*"],
    ]);
  });

  it("sends at once to a host it knows, keeping the transfer list and the options form", () => {
    const labels = siteLabels();
    labels.verify(HOST_B, fromB());
    const { sent, post } = posterFor(labels);
    const port = {};
    post(popup, "a", "https://www.site-b.test:443/path", [[port]]);
    post(popup, "b", { targetOrigin: "https://www.site-b.test", transfer: [port] }, []);
    post(popup, "c", { targetOrigin: "*" }, []);
    expect(sent.map((call) => call.slice(2))).toEqual([
      [HOST_B, [port]],
      [{ targetOrigin: HOST_B, transfer: [port] }],
      [{ targetOrigin: "*" }],
    ]);
    expect((sent[0]?.[1] as MessageEnvelope).t).toBe("https://www.site-b.test");
  });

  it("drops a message for the sender's own origin or no web origin, and lets the browser refuse a bad one", async () => {
    const { sent, post } = posterFor(siteLabels());
    post(popup, "own", "/", []);
    post(popup, "default", undefined, []);
    post(popup, "file", "file:///x", []);
    post(popup, "bad", "not a url", []);
    await Promise.resolve();
    expect(sent.map((call) => call[2])).toEqual(["not a url"]);
  });

  it("drops a message whose host never resolves", async () => {
    vi.useFakeTimers();
    try {
      const nobody = posterFor(siteLabels(async () => null));
      nobody.post(popup, "lost", "https://site-z.test", []);
      await vi.advanceTimersByTimeAsync(0);
      expect(nobody.sent).toEqual([]);

      const { sent, post } = posterFor(
        siteLabels(() => new Promise(() => {})),
        setTimeout,
      );
      post(popup, "stuck", "https://site-b.test", []);
      post(popup, "next", "*", []);
      await vi.advanceTimersByTimeAsync(CROSS_SITE_TIMEOUT_MS - 1);
      expect(sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map((call) => [(call[1] as MessageEnvelope).d, call[2]])).toEqual([["next", "*"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the queue going when one message cannot be sent", async () => {
    const sent: unknown[] = [];
    const native = (message: MessageEnvelope) => {
      if (message.d === "bad") throw new DOMException("could not clone", "DataCloneError");
      sent.push(message.d);
    };
    const post = createCrossSitePoster(
      siteLabels(async () => HOST_B),
      direct,
      native as unknown as Window["postMessage"],
      setTimeout,
    );
    post(popup, "bad", "https://site-b.test", []);
    post(popup, "good", "*", []);
    await vi.waitFor(() => expect(sent).toEqual(["good"]));
  });

  it("posts the same while a page has replaced built-ins", () => {
    const run = () => {
      const labels = siteLabels();
      labels.verify(HOST_B, fromB());
      const { sent, post } = posterFor(labels);
      post(popup, "a", "https://www.site-b.test", []);
      post(popup, "b", "*", []);
      post(popup, "c", "/", []);
      return sent;
    };
    const expected = run();
    expect(expected).toHaveLength(2);
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, property, replacement, run), name).toEqual(expected);
    }
  });
});

describe("createSiteMessaging", () => {
  it("is only made for a document on a site host", () => {
    expect(
      createSiteMessaging(fakeMessagingWin([], HOST_A), ctxFor("https://site-a.test", HOST_A), direct, undefined),
    ).toBeNull();
  });

  it("asks and posts with the window's own natives, taken before the hooks replace them", async () => {
    const asked: string[] = [];
    const sent: unknown[][] = [];
    const timers: number[] = [];
    const win = {
      fetch(url: string, init: RequestInit) {
        asked.push(`${url} ${String(init.body)}`);
        return Promise.resolve(new Response(JSON.stringify({ hosts: [["https://site-b.test", HOST_B]] })));
      },
      postMessage(...args: unknown[]) {
        sent.push(args);
      },
      setTimeout(_handler: () => void, delay: number) {
        timers.push(delay);
        return 0;
      },
    } as unknown as Realm;
    const messaging = createSiteMessaging(win, ctxFor("https://site-a.test", HOST_A), direct, SITES);
    win.fetch = () => Promise.reject(new Error("hooked"));
    win.postMessage = () => {};
    messaging?.post({}, "hi", "https://site-b.test", []);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(asked).toEqual([`${HOST_A}/_g/rpc/label {"v":2,"origins":["https://site-b.test"]}`]);
    expect(sent[0]?.[1]).toBe(HOST_B);
    expect(timers).toEqual([CROSS_SITE_TIMEOUT_MS]);
  });
});

describe("createSiteMessaging for a window that inherits its page", () => {
  it("asks through the lookup of the window it inherits from", async () => {
    const sent: unknown[][] = [];
    const blank = {
      fetch: () => Promise.reject(new Error("a blank window may have no worker")),
      postMessage: (...args: unknown[]) => sent.push(args),
      setTimeout,
    } as unknown as Realm;
    const parent = createSiteMessaging(
      {
        ...blank,
        fetch: () => Promise.resolve(new Response(JSON.stringify({ hosts: [["https://site-b.test", HOST_B]] }))),
      } as unknown as Realm,
      ctxFor("https://site-a.test", HOST_A),
      direct,
      SITES,
    );
    const child = createSiteMessaging(
      blank,
      ctxFor("https://site-a.test", HOST_A),
      direct,
      SITES,
      () => parent?.lookup,
    );
    child?.post({}, "hi", "https://site-b.test", []);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.[1]).toBe(HOST_B);
  });
});

describe("installMessaging in subdomain mode", () => {
  type FakeEvent = MessageEvent & { stopped?: boolean };

  /** A site-a realm whose MessageEvent getters read the fake event's own native fields. */
  function siteRealm() {
    const listeners: Array<[string, (event: unknown) => void, unknown]> = [];
    const proto = {
      get data() {
        return (this as unknown as { nativeData: unknown }).nativeData;
      },
      get origin() {
        return (this as unknown as { nativeOrigin: string }).nativeOrigin;
      },
      get source() {
        return null;
      },
    };
    const win = {
      ...fakeMessagingWin([], HOST_A),
      MessageEvent: { prototype: proto },
      Event: {
        prototype: {
          stopImmediatePropagation(this: { stopped: boolean }) {
            this.stopped = true;
          },
        },
      },
      addEventListener: (type: string, listener: (event: unknown) => void, capture: unknown) =>
        listeners.push([type, listener, capture]),
    } as unknown as Realm;
    const event = (nativeOrigin: string, nativeData: unknown, isTrusted = true): FakeEvent =>
      Object.assign(Object.create(proto) as FakeEvent, { nativeOrigin, nativeData, isTrusted });
    const site = installMessaging(win, ctxFor("https://site-a.test", HOST_A), direct, asIs, siteLabels());
    site?.listen();
    const dispatch = (message: FakeEvent) => {
      for (const [type, listener] of listeners) if (type === "message") listener(message);
      return message.stopped === true;
    };
    return { listeners, event, dispatch };
  }

  it("unwraps a verified envelope and reports the sender's real origin", () => {
    const { event } = siteRealm();
    const message = event(HOST_B, fromB());
    expect(message.data).toBe(5);
    expect(message.origin).toBe("https://www.site-b.test");
  });

  it("unwraps the same while a page has replaced built-ins", () => {
    const { event } = siteRealm();
    const read = () => {
      const message = event(HOST_B, fromB());
      const forged = event(HOST_B, fromB({ s: "https://site-c.test" }));
      return [message.data, message.origin, forged.origin, event(HOST_A, "own").origin];
    };
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, property, replacement, read), name).toEqual([
        5,
        "https://www.site-b.test",
        "null",
        HOST_A,
      ]);
    }
  });

  it("listens in the capture phase", () => {
    const { listeners } = siteRealm();
    expect(listeners.map(([type, , capture]) => [type, capture])).toEqual([["message", true]]);
  });

  it("stops a forged or misaddressed envelope before page listeners", () => {
    const { event, dispatch } = siteRealm();
    expect(dispatch(event(HOST_B, fromB({ t: "https://site-c.test" })))).toBe(true);
    expect(dispatch(event(HOST_B, fromB({ s: "https://site-c.test" })))).toBe(true);
    expect(dispatch(event(HOST_B, fromB({ t: "https://site-a.test" })))).toBe(false);
    expect(dispatch(event(HOST_B, fromB()))).toBe(false);
    expect(dispatch(event(HOST_B, "plain"))).toBe(false);
  });

  it("reports null as the origin of a plain message from another site host", () => {
    const { event } = siteRealm();
    const plain = event(HOST_B, "plain");
    expect(plain.origin).toBe("null");
    expect(plain.data).toBe("plain");
    expect(event(HOST_B, fromB({ s: "https://site-c.test" })).origin).toBe("null");
  });

  it("leaves events from this host, from elsewhere and made by the page as they are", () => {
    const { event, dispatch } = siteRealm();
    const own = event(HOST_A, fromB());
    expect(own.data).toEqual(fromB());
    expect(dispatch(own)).toBe(false);
    expect(event("https://elsewhere.test", "x").origin).toBe("https://elsewhere.test");
    const made = event(HOST_B, fromB(), false);
    expect(made.data).toEqual(fromB());
    expect(made.origin).toBe(HOST_B);
    expect(dispatch(made)).toBe(false);
  });

  it("installs nothing new without a site context", () => {
    const win = fakeMessagingWin([], "http://proxy.test");
    expect(installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"), direct, asIs)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(win.MessageEvent.prototype, "data")).toBeUndefined();
  });
});

describe("createMessageSender in subdomain mode", () => {
  it("hands a window it cannot read to the site poster", () => {
    const crossOrigin: Record<string, unknown> = {};
    crossOrigin.window = crossOrigin;
    Object.defineProperty(crossOrigin, "location", {
      get() {
        throw new Error("SecurityError");
      },
    });
    const posted: unknown[][] = [];
    const sender = createMessageSender(
      { postMessage() {} } as unknown as Realm,
      ctxFor("https://site-a.test", HOST_A),
      direct,
      () => false,
      (...args) => posted.push(args),
    );
    const standIn = sender(crossOrigin) as { postMessage(...args: unknown[]): void };
    standIn.postMessage("hi", "https://site-b.test", ["t"]);
    expect(posted).toEqual([[crossOrigin, "hi", "https://site-b.test", [["t"]]]]);
    const port = { postMessage() {} };
    expect(sender(port)).toBe(port);
  });
});
