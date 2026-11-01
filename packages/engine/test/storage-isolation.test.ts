import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installStorageIsolation } from "../src/client/storage-isolation.ts";
import { prefixFor } from "../src/shared/partition.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { recordingCalls } from "./recording-calls.ts";
import { withReplaced } from "./replaced-builtins.ts";
import { spyBuiltins } from "./spied-builtins.ts";

function ctxFor(origin: string): UrlContext {
  return { realUrl: () => new URL(`${origin}/`) } as unknown as UrlContext;
}

function fakeStorageWin(opened: string[], dbNames: string[], cacheNames: string[]) {
  class IDBFactory {
    open(name: string) {
      opened.push(`idb:${name}`);
      return {};
    }
    deleteDatabase(name: string) {
      opened.push(`idb-del:${name}`);
      return {};
    }
    databases() {
      return Promise.resolve(dbNames.map((name) => ({ name })));
    }
  }
  class CacheStorage {
    open(name: string) {
      opened.push(`cache:${name}`);
      return Promise.resolve({});
    }
    keys() {
      return Promise.resolve([...cacheNames]);
    }
    match(_request: string, options: { cacheName: string }) {
      opened.push(`cache-match:${options.cacheName}`);
      return Promise.resolve(undefined);
    }
  }
  class LockManager {
    request(...[name]: [string, unknown?]) {
      opened.push(`lock:${name}`);
      return Promise.resolve();
    }
    query() {
      return Promise.resolve({ held: [], pending: [] });
    }
  }
  return {
    IDBFactory,
    CacheStorage,
    LockManager,
    indexedDB: new IDBFactory(),
    caches: new CacheStorage(),
    locks: new LockManager(),
    Promise,
    Object,
    Array,
  } as unknown as Realm & { locks: LockManager; LockManager: typeof LockManager };
}

function fakeCachesWin(backing: Map<string, Map<string, string>>) {
  class CacheStorage {
    open(name: string) {
      if (!backing.has(name)) backing.set(name, new Map());
      const store = backing.get(name) as Map<string, string>;
      return Promise.resolve({
        match: (request: string) => Promise.resolve(store.get(request)),
        put: (request: string, value: string) => Promise.resolve(void store.set(request, value)),
      });
    }
    keys() {
      return Promise.resolve([...backing.keys()]);
    }
    match(request: string) {
      for (const store of backing.values()) if (store.has(request)) return Promise.resolve(store.get(request));
      return Promise.resolve(undefined);
    }
  }
  return { CacheStorage, caches: new CacheStorage(), Promise, Object, Array } as unknown as Realm;
}

/** A window's own Promise, Object and Array, from another realm than the runtime's, as in a window the browser reused. */
const PAGE = runInNewContext("({ Promise, Object, Array })") as {
  Promise: PromiseConstructor;
  Object: ObjectConstructor;
  Array: ArrayConstructor;
};

type CookieItem = { name: string; value: string };
interface CookieStoreShim {
  get(name: unknown): Promise<CookieItem | null>;
  getAll(): Promise<CookieItem[]>;
  set(name: unknown, value?: unknown): Promise<void>;
  delete(name: unknown): Promise<void>;
}

function cookieStoreWin(document: { cookie: string }) {
  const store = {} as CookieStoreShim;
  const win = { cookieStore: store, document, ...PAGE } as unknown as Realm;
  return { win, store };
}

describe("installStorageIsolation", () => {
  it("supports the string and object forms of cookieStore.get", async () => {
    const { win, store } = cookieStoreWin({ cookie: "session=abc; theme=dark" });
    installStorageIsolation(win, ctxFor("https://site.test"), () => prefixFor("https://site.test"));
    expect(await store.get("theme")).toEqual({ name: "theme", value: "dark" });
    expect(await store.get({ name: "session" })).toEqual({ name: "session", value: "abc" });
    expect(await store.get("none")).toBeNull();
  });

  it("keeps cookieStore on the mirror for a store the next document of the window gets", async () => {
    class CookieStore {
      get(): Promise<unknown> {
        return Promise.resolve("native");
      }
    }
    const document = { cookie: "a=1" };
    const win = { cookieStore: new CookieStore(), CookieStore, document, ...PAGE } as unknown as Realm;
    installStorageIsolation(win, ctxFor("https://site.test"), () => prefixFor("https://site.test"));
    const next = new CookieStore() as unknown as CookieStoreShim;
    expect(Object.getOwnPropertyNames(next)).toEqual([]);
    expect(await next.get("a")).toEqual({ name: "a", value: "1" });
  });

  it("answers storage listings in the page's own realm, out of reach of the built-ins of the realm that made it", async () => {
    const prefix = prefixFor("https://a.test");
    // The window's own storage APIs, from another realm, answering with names that carry the marker.
    const page = runInNewContext(`(prefix) => {
      const response = { body: "s3cr3tr" };
      class Cache {
        match(request, options) {
          void (options && options.ignoreSearch);
          return Promise.resolve(response);
        }
      }
      class IDBFactory {
        open() { return {}; }
        deleteDatabase() { return {}; }
        databases() { return Promise.resolve([{ name: prefix + "s3cr3td", version: 1 }, { name: "other" }]); }
      }
      class CacheStorage {
        open() { return Promise.resolve(new Cache()); }
        has() { return Promise.resolve(true); }
        delete() { return Promise.resolve(true); }
        keys() { return Promise.resolve([prefix + "s3cr3tc", "other"]); }
        match(request, options) {
          void options.ignoreSearch;
          return Promise.resolve({ body: options.cacheName });
        }
      }
      class LockManager {
        request() { return Promise.resolve(); }
        query() {
          const held = [{ name: prefix + "s3cr3tl", mode: "exclusive", clientId: "c" }, { name: "other" }];
          return Promise.resolve({ held, pending: [] });
        }
      }
      return {
        Promise, Object, Array, IDBFactory, CacheStorage, LockManager, response,
        indexedDB: new IDBFactory(), caches: new CacheStorage(), locks: new LockManager(),
      };
    }`)(prefix) as Realm & { locks: { query(): Promise<unknown> }; LockManager: unknown; response: unknown };
    const win = page;
    installStorageIsolation(win, ctxFor("https://a.test"), () => prefix);
    const options = { cacheName: "s3cr3tc" };
    const out: unknown[] = [0, 0, 0, 0, 0];
    const seen = await spyBuiltins("s3cr3t", async () => {
      out[0] = await win.indexedDB.databases();
      out[1] = await win.caches.keys();
      out[2] = await win.caches.match("/x");
      out[3] = await win.caches.match("/x", options);
      out[4] = await win.locks.query();
    });
    expect(seen).toEqual([]);
    expect(out).toEqual([
      [{ name: "s3cr3td", version: 1 }],
      ["s3cr3tc"],
      { body: "s3cr3tr" },
      { body: `${prefix}s3cr3tc` },
      { held: [{ name: "s3cr3tl", mode: "exclusive", clientId: "c" }], pending: [] },
    ]);
    expect(out[2]).toBe(page.response);
    for (const index of [0, 1]) expect(Object.getPrototypeOf(out[index])).toBe(page.Array.prototype);
    expect(Object.getPrototypeOf(out[4])).toBe(page.Object.prototype);
    expect(Object.getPrototypeOf((out[0] as object[])[0])).toBe(page.Object.prototype);
    expect(win.caches.match("/x")).toBeInstanceOf(page.Promise);
  });

  it("answers cookieStore in the page's own realm, out of reach of the built-ins of the realm that made it", async () => {
    const secret = "s3cr3t";
    const writes = ["", "", ""];
    let written = 0;
    let cookie = `${secret}a=1; ${secret}b=${secret}2; ${secret}c`;
    const { win, store } = cookieStoreWin({
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        // Into a slot that exists: push and new indices reach what the spies wrap.
        writes[written++] = value;
      },
    });
    const url = new URL(`https://site.test/${secret}/page`);
    const ctx = { realUrl: () => url } as unknown as UrlContext;
    installStorageIsolation(win, ctx, () => prefixFor("https://site.test"));
    const named = { name: `${secret}a` };
    const item = { name: `${secret}d`, value: `${secret}4` };
    const answers: unknown[] = [0, 0, 0, 0, 0, 0, 0];
    const seen = await spyBuiltins(secret, async () => {
      answers[0] = await store.get(`${secret}b`);
      answers[1] = await store.get(named);
      answers[2] = await store.getAll();
      answers[3] = await store.set(`${secret}c`, `${secret}3`);
      answers[4] = await store.set(item);
      answers[5] = await store.delete(named);
      cookie = "";
      answers[6] = await store.get(`${secret}b`);
    });
    expect(seen).toEqual([]);
    expect(answers).toEqual([
      { name: `${secret}b`, value: `${secret}2` },
      { name: `${secret}a`, value: "1" },
      [
        { name: `${secret}a`, value: "1" },
        { name: `${secret}b`, value: `${secret}2` },
        { name: `${secret}`, value: `${secret}c` },
      ],
      undefined,
      undefined,
      undefined,
      null,
    ]);
    expect(Object.getPrototypeOf(answers[0])).toBe(PAGE.Object.prototype);
    expect(Object.getPrototypeOf(answers[2])).toBe(PAGE.Array.prototype);
    expect(store.get("x")).toBeInstanceOf(PAGE.Promise);
    expect(writes).toEqual([
      `${secret}c=${secret}3; path=/${secret}/page`,
      `${secret}d=${secret}4; path=/${secret}/page`,
      `${secret}a=; expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    ]);
  });

  it("confines caches.match to the current origin", async () => {
    const backing = new Map<string, Map<string, string>>([
      ["__g|https://site-a.test|c", new Map([["/x", "A"]])],
      ["__g|https://site-b.test|c", new Map([["/x", "B"]])],
    ]);
    const win = fakeCachesWin(backing);
    installStorageIsolation(win, ctxFor("https://site-b.test"), () => prefixFor("https://site-b.test"));
    expect(await win.caches.match("/x")).toBe("B");
  });

  it("prefixes IndexedDB and Cache names by origin and strips them back", async () => {
    const opened: string[] = [];
    const win = fakeStorageWin(opened, ["__g|https://site.test|db1", "other"], ["__g|https://site.test|c1", "x"]);
    installStorageIsolation(win, ctxFor("https://site.test"), () => prefixFor("https://site.test"));
    win.indexedDB.open("db1");
    void win.caches.open("c1");
    expect(opened).toEqual(["idb:__g|https://site.test|db1", "cache:__g|https://site.test|c1"]);
    expect(await win.indexedDB.databases()).toEqual([{ name: "db1" }]);
    expect(await win.caches.keys()).toEqual(["c1"]);
  });

  it("uses the partition it is given", async () => {
    const opened: string[] = [];
    const partition = "__g^|https://top.test|https://a.test|";
    const win = fakeStorageWin(opened, [`${partition}db1`, "__g|https://a.test|db2"], []);
    installStorageIsolation(win, ctxFor("https://a.test"), () => partition);
    win.indexedDB.open("db1");
    expect(opened).toEqual([`idb:${partition}db1`]);
    expect(await win.indexedDB.databases()).toEqual([{ name: "db1" }]);
  });

  it("lists only its own names after page code replaced String and Array methods", async () => {
    const own = "__g^|https://top.test|https://a.test|";
    const names = [`${own}db1`, "__g^|https://other.test|https://a.test|db2"];
    const win = fakeStorageWin([], names, [...names]);
    installStorageIsolation(win, ctxFor("https://a.test"), () => own);
    const startsWith = String.prototype.startsWith;
    const map = Array.prototype.map;
    const iterator = Array.prototype[Symbol.iterator];
    const seen: unknown[] = [];
    let listed: unknown[];
    String.prototype.startsWith = () => true;
    try {
      // Replaced once the fakes have answered, since they use these methods themselves.
      const pending = [win.indexedDB.databases(), win.caches.keys()];
      Array.prototype.map = function (this: unknown[]) {
        seen.push(this);
        return [];
      };
      Array.prototype[Symbol.iterator] = function (this: unknown[]) {
        seen.push(this);
        return Reflect.apply(iterator, this, []) as ArrayIterator<unknown>;
      };
      listed = [await pending[0], await pending[1]];
    } finally {
      String.prototype.startsWith = startsWith;
      Array.prototype.map = map;
      Array.prototype[Symbol.iterator] = iterator;
    }
    expect(listed).toEqual([[{ name: "db1" }], ["db1"]]);
    expect(seen.filter((value) => Array.isArray(value) && value.length === 2)).toEqual([]);
  });

  it("never hands its natives to a replaced Function.prototype.call", () => {
    const opened: string[] = [];
    const win = fakeStorageWin(opened, [], []);
    const natives = [win.IDBFactory.prototype, win.CacheStorage.prototype, win.LockManager.prototype].flatMap((proto) =>
      Object.values(Object.getOwnPropertyDescriptors(proto)).map((descriptor) => descriptor.value),
    );
    installStorageIsolation(win, ctxFor("https://a.test"), () => "__g|https://a.test|");
    const seen = recordingCalls(() => {
      win.indexedDB.open("db");
      win.indexedDB.deleteDatabase("db");
      void win.indexedDB.databases();
      void win.caches.open("c");
      void win.caches.keys();
      void win.caches.match("/x", { cacheName: "c" });
      void win.locks.request("l", () => {});
      void win.locks.query();
    });
    expect(natives.filter((native) => seen.includes(native))).toEqual([]);
    expect(opened).toEqual([
      "idb:__g|https://a.test|db",
      "idb-del:__g|https://a.test|db",
      "cache:__g|https://a.test|c",
      "cache-match:__g|https://a.test|c",
      "lock:__g|https://a.test|l",
    ]);
  });
});

describe("installStorageIsolation inside an adoption", () => {
  it("prefixes every name when the page replaced the array iterator before the frame was adopted", () => {
    const opened: string[] = [];
    const win = fakeStorageWin(opened, [], []);
    const partition = () => prefixFor("https://a.test");
    withReplaced(Array.prototype, Symbol.iterator, { value: function* () {} }, () =>
      installStorageIsolation(win, ctxFor("https://a.test"), partition),
    );
    win.indexedDB.open("__girici");
    expect(opened).toEqual([`idb:${prefixFor("https://a.test")}__girici`]);
  });
});
