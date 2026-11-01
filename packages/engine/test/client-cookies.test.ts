import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { installCookies } from "../src/client/cookies.ts";
import { COOKIE_MESSAGE, encodeHeaderValue, PROTOCOL_VERSION, type CookieSnapshot } from "../src/shared/protocol.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";
import { spyBuiltins } from "./spied-builtins.ts";

type Handler = (event: { data: unknown }) => void;

interface PageRealm {
  Promise: PromiseConstructor;
  Response: new (status: number, body?: string) => Response;
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

/** The window's own built-ins come from another realm than the runtime's, as in a window the browser reused. */
const PAGE = runInNewContext(`({
  Promise,
  Response: class Response {
    #status;
    #body;
    constructor(status, body = "{}") {
      this.#status = status;
      this.#body = body;
    }
    get status() {
      return this.#status;
    }
    json() {
      return Promise.resolve(JSON.parse(this.#body));
    }
  },
  parse: (text) => JSON.parse(text),
  stringify: (value) => JSON.stringify(value),
})`) as PageRealm;

/** A worker's answer to a cookie write, made with the page's built-ins only. */
function answer(status: number, cookies: CookieSnapshot[] = []): Promise<Response> {
  return PAGE.Promise.resolve(new PAGE.Response(status, PAGE.stringify({ cookies })));
}

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
    Response: PAGE.Response,
    fetch: () => answer(200),
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
      return answer(200);
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

  it("reads worker messages and sync headers with natives taken at load and own fields only", () => {
    const { win, ctx, document, container, send } = makeRealm();
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [] },
      () => container,
      () => {},
    );
    withReplaced(Array, "isArray", { value: () => false }, () =>
      send({ type: "girici:cookies", v: PROTOCOL_VERSION, changes: [fromOtherTab] }),
    );
    expect(document.cookie).toBe("t=1");
    withPrototypeAdditions(
      {
        type: { value: "girici:cookies", writable: true },
        v: { value: PROTOCOL_VERSION, writable: true },
        changes: { value: [cookie("forged", "1")], writable: true },
      },
      () => send({}),
    );
    send({ type: "girici:cookies", v: PROTOCOL_VERSION, changes: [{ name: "half", value: "1" }] });
    expect(document.cookie).toBe("t=1");
    const header = encodeHeaderValue(JSON.stringify([cookie("synced", "1")]));
    withReplaced(JSON, "parse", { value: () => [cookie("forged", "1")] }, () => bridge.applySync(header));
    expect(document.cookie).toBe("t=1; synced=1");
  });

  it("writes its RPC body without the page's JSON.stringify or toJSON", () => {
    const bodies: unknown[] = [];
    const { win, ctx, document, container } = makeRealm();
    (win as unknown as { fetch: unknown }).fetch = (_url: unknown, init: { body: unknown }) => {
      bodies.push(init.body);
      return answer(200);
    };
    installCookies(
      win,
      ctx,
      { v: 2, cookies: [] },
      () => container,
      () => {},
    );
    const seen: unknown[] = [];
    withReplaced(JSON, "stringify", { value: (value: unknown) => (seen.push(value), "{}") }, () =>
      withPrototypeAdditions({ toJSON: { value: () => "forged", writable: true } }, () => {
        document.cookie = 'k="1"';
      }),
    );
    expect(seen).toEqual([]);
    expect(JSON.parse(bodies[0] as string)).toEqual({ v: PROTOCOL_VERSION, seq: 1, cookie: 'k="1"' });
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
      new PAGE.Promise((resolve) => {
        answers.push((cookies) => resolve(answer(200, cookies)));
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
    (win as unknown as { fetch: unknown }).fetch = () => answer(409);
    const reload = vi.fn();
    installCookies(win, ctx, { v: 2, cookies: [] }, () => container, reload);
    win.document.cookie = "a=1";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });

  it("lets go of writes the worker never answers", async () => {
    const { win, ctx, container } = makeRealm();
    (win as unknown as { fetch: unknown }).fetch = () => PAGE.Promise.reject(new Error("offline"));
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [] },
      () => container,
      () => {},
    );
    win.document.cookie = "a=1";
    win.document.cookie = "b=2";
    await bridge.pendingWrites();
    expect(bridge.pendingWrites()).toBeNull();
    expect(win.document.cookie).toBe("a=1; b=2");
  });

  it("keeps the cookies it reads, writes and hears away from the built-ins of the realm that made it", async () => {
    const secret = "s3cr3t";
    const { win, ctx, document, container, send } = makeRealm();
    const url = new URL(`https://site.test/${secret}/page`);
    (ctx as { realUrl: () => URL }).realUrl = () => url;
    const answered = [cookie(`${secret}w`, `${secret}1`), cookie(`${secret}j`, "1")];
    (win as unknown as { fetch: unknown }).fetch = () => answer(200, answered);
    const bridge = installCookies(
      win,
      ctx,
      { v: 2, cookies: [cookie(`${secret}c`, "1")] },
      () => container,
      () => {},
    );
    const changes = [cookie(`${secret}m`, "1")];
    const message = PAGE.parse(JSON.stringify({ type: COOKIE_MESSAGE, v: PROTOCOL_VERSION, changes }));
    const header = encodeHeaderValue(JSON.stringify([cookie(`${secret}s`, "1")]));
    const writes = [`${secret}w=${secret}1; path=/; max-age=60; expires=Thu, 01 Jan 2099 00:00:00 GMT`, `${secret}x=1`];
    const reads = ["", "", ""];
    const seen = await spyBuiltins(secret, async () => {
      document.cookie = writes[0] as string;
      document.cookie = writes[1] as string;
      reads[0] = document.cookie;
      send(message);
      bridge.applySync(header);
      reads[1] = document.cookie;
      await bridge.pendingWrites();
      reads[2] = document.cookie;
    });
    expect(seen).toEqual([]);
    expect(reads).toEqual([
      `${secret}x=1; ${secret}c=1; ${secret}w=${secret}1`,
      `${secret}x=1; ${secret}c=1; ${secret}m=1; ${secret}s=1; ${secret}w=${secret}1`,
      `${secret}w=${secret}1; ${secret}j=1`,
    ]);
  });
});
