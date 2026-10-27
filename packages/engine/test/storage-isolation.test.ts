import { describe, expect, it } from "vitest";
import { installStorageIsolation } from "../src/client/storage-isolation.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

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
  }
  return {
    IDBFactory,
    CacheStorage,
    indexedDB: new IDBFactory(),
    caches: new CacheStorage(),
  } as unknown as Realm;
}

describe("installStorageIsolation", () => {
  it("prefixes IndexedDB and Cache names by origin and strips them back", async () => {
    const opened: string[] = [];
    const win = fakeStorageWin(opened, ["__g|https://site.test|db1", "other"], ["__g|https://site.test|c1", "x"]);
    installStorageIsolation(win, ctxFor("https://site.test"));
    win.indexedDB.open("db1");
    void win.caches.open("c1");
    expect(opened).toEqual(["idb:__g|https://site.test|db1", "cache:__g|https://site.test|c1"]);
    expect(await win.indexedDB.databases()).toEqual([{ name: "db1" }]);
    expect(await win.caches.keys()).toEqual(["c1"]);
  });
});
