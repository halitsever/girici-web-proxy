import { describe, expect, it, vi } from "vitest";
import { installCookies } from "../src/client/cookies.ts";
import { encodeHeaderValue, PROTOCOL_VERSION, type CookieSnapshot } from "../src/shared/protocol.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { withReplaced } from "./replaced-builtins.ts";

type Handler = (event: { data: unknown }) => void;

function makeRealm() {
  const handlers: Handler[] = [];
  const container = {
    addEventListener: (_type: string, handler: Handler) => handlers.push(handler),
    startMessages: () => undefined,
  } as unknown as ServiceWorkerContainer;
  const constructed: unknown[] = [];
  const Document = { prototype: {} as Record<string, unknown> };
  const document = Object.create(Document.prototype) as { cookie: string };
  const win = {
    document,
    Document,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ cookies: [] }) }),
    sessionStorage: { getItem: () => null, setItem: () => undefined },
    location: { reload: () => undefined },
    BroadcastChannel: class {
      constructor() {
        constructed.push(this);
      }
    },
  } as unknown as Realm;
  const ctx = { realUrl: () => new URL("https://site.test/") } as unknown as UrlContext;
  const send = (data: unknown) => {
    for (const handler of handlers) handler({ data });
  };
  return { win, ctx, document, container, send, constructed };
}

/** A host-only cookie for the fake realm's host. */
function cookie(name: string, value: string): CookieSnapshot {
  return { name, value, domain: "site.test", path: "/", hostOnly: true, secure: false, expires: null, creation: 1 };
}

const fromOtherTab: CookieSnapshot = {
  name: "t",
  value: "1",
  domain: "site.test",
  path: "/",
  hostOnly: true,
  secure: false,
  expires: null,
  creation: 1,
};

describe("installCookies", () => {
  it("keeps cookie sequence state per realm", () => {
    const a = makeRealm();
    const b = makeRealm();
    const ca = installCookies(
      a.win,
      a.ctx,
      { v: 1, cookies: [] },
      () => a.container,
      () => {},
    );
    const cb = installCookies(
      b.win,
      b.ctx,
      { v: 1, cookies: [] },
      () => b.container,
      () => {},
    );
    a.document.cookie = "x=1";
    expect(ca.currentSeq()).toBe(1);
    expect(cb.currentSeq()).toBe(0);
  });

  it("posts cookie writes to an absolute RPC URL, so blob documents can reach it", () => {
    const urls: unknown[] = [];
    const { win, ctx, document, container } = makeRealm();
    (win as unknown as { fetch: unknown }).fetch = (url: unknown) => {
      urls.push(url);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ cookies: [] }) });
    };
    (ctx as { origin: string }).origin = "http://proxy.test";
    installCookies(
      win,
      ctx,
      { v: 1, cookies: [] },
      () => container,
      () => {},
    );
    document.cookie = "a=1";
    expect(urls[0]).toBe("http://proxy.test/_g/rpc/cookie");
  });

  it("applies cookie messages from the service worker", () => {
    const { win, ctx, document, container, send } = makeRealm();
    installCookies(
      win,
      ctx,
      { v: 1, cookies: [] },
      () => container,
      () => {},
    );
    send({ type: "girici:cookies", v: PROTOCOL_VERSION, changes: [fromOtherTab] });
    expect(document.cookie).toBe("t=1");
  });

  it("ignores cookie messages of another type or version", () => {
    const { win, ctx, document, container, send } = makeRealm();
    installCookies(
      win,
      ctx,
      { v: 1, cookies: [] },
      () => container,
      () => {},
    );
    send({ type: "girici:cookies", v: 1, changes: [fromOtherTab] });
    send({ type: "cookies", v: PROTOCOL_VERSION, changes: [fromOtherTab] });
    expect(document.cookie).toBe("");
  });

  it("constructs no BroadcastChannel", () => {
    const { win, ctx, container, constructed } = makeRealm();
    installCookies(
      win,
      ctx,
      { v: 1, cookies: [] },
      () => container,
      () => {},
    );
    expect(constructed).toEqual([]);
  });

  it("shows no cookies at all in a frame whose cookies are blocked", () => {
    const { win, ctx, document, container, send } = makeRealm();
    const bridge = installCookies(
      win,
      ctx,
      { v: 1, cookies: [], cookiesBlocked: true },
      () => container,
      () => {},
    );
    send({ type: "girici:cookies", v: PROTOCOL_VERSION, changes: [fromOtherTab] });
    bridge.applySync(encodeHeaderValue(JSON.stringify([fromOtherTab])));
    document.cookie = "own=1";
    expect(document.cookie).toBe("");
  });

  it("starts a renewed document from its own cookies", () => {
    const { win, ctx, container } = makeRealm();
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [cookie("a", "1")] },
      () => container,
      () => {},
    );
    win.document.cookie = "c=3";
    bridge.reset({ v: 2, cookies: [cookie("b", "2")] });
    expect(win.document.cookie).toBe("b=2");
    expect(bridge.currentSeq()).toBe(0);
  });

  it("ignores answers to writes the previous document made", async () => {
    const { win, ctx, container } = makeRealm();
    const answers: Array<(cookies: CookieSnapshot[]) => void> = [];
    (win as unknown as { fetch: unknown }).fetch = () =>
      new Promise((resolve) => {
        answers.push((cookies) => resolve({ status: 200, json: () => Promise.resolve({ cookies }) }));
      });
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [] },
      () => container,
      () => {},
    );
    win.document.cookie = "old=1";
    bridge.reset({ v: 2, cookies: [] });
    win.document.cookie = "new=1";
    answers[0]?.([cookie("old", "1")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(win.document.cookie).toBe("new=1");
  });

  it("lifts a block that the renewed document does not carry", () => {
    const { win, ctx, container } = makeRealm();
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [], cookiesBlocked: true },
      () => container,
      () => {},
    );
    bridge.reset({ v: 2, cookies: [cookie("b", "2")] });
    win.document.cookie = "own=1";
    expect(win.document.cookie).toBe("b=2; own=1");
    expect(bridge.snapshot().map((c) => c.name)).toEqual(["b", "own"]);
  });

  it("hands frames a cookie snapshot built without the page's array iterator or prototypes", () => {
    const { win, ctx, container } = makeRealm();
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [cookie("a", "1")] },
      () => container,
      () => {},
    );
    const snapshot = withReplaced(
      Array.prototype,
      Symbol.iterator,
      {
        value: function* () {
          yield cookie("forged", "1");
        },
      },
      () => bridge.snapshot(),
    );
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.name).toBe("a");
    expect(Object.getPrototypeOf(snapshot[0])).toBeNull();
  });

  it("reloads through the location call it was given when the worker has moved on", async () => {
    const { win, ctx, container } = makeRealm();
    const direct = vi.fn();
    (win as unknown as { location: unknown }).location = { reload: direct };
    (win as unknown as { fetch: unknown }).fetch = () => Promise.resolve({ status: 409 });
    const reload = vi.fn();
    installCookies(win, ctx, { v: 2, cookies: [] }, () => container, reload);
    win.document.cookie = "a=1";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });
});
