import { describe, expect, it } from "vitest";
import { installStorageIsolation } from "../src/client/storage-isolation.ts";
import { prefixFor } from "../src/shared/partition.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { recordingCalls } from "./recording-calls.ts";

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
  return { CacheStorage, caches: new CacheStorage() } as unknown as Realm;
}

describe("installStorageIsolation", () => {
  it("supports the string and object forms of cookieStore.get", async () => {
    const store: Record<string, unknown> = {};
    const win = {
      cookieStore: store,
      document: { cookie: "session=abc; theme=dark" },
    } as unknown as Realm;
    installStorageIsolation(win, ctxFor("https://site.test"), () => prefixFor("https://site.test"));
    const get = store.get as (name: unknown) => Promise<{ name: string; value: string } | null>;
    expect(await get("theme")).toEqual({ name: "theme", value: "dark" });
    expect(await get({ name: "session" })).toEqual({ name: "session", value: "abc" });
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
