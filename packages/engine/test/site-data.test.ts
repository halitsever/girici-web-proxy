import { describe, expect, it } from "vitest";
import { partitionOrigin } from "../src/shared/partition.ts";
import { clearPartitions, partitionOrigins, type SiteDataEnv } from "../src/shared/site-data.ts";

function fakeStorage(keys: string[]): Storage {
  const map = new Map(keys.map((key) => [key, "v"]));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage;
}

function keysOf(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) keys.push(storage.key(index) ?? "");
  return keys;
}

function fakeEnv(input: { local?: string[]; session?: string[]; dbs?: string[]; caches?: string[] }) {
  const local = fakeStorage(input.local ?? []);
  const session = fakeStorage(input.session ?? []);
  const dbs = [...(input.dbs ?? [])];
  const caches = [...(input.caches ?? [])];
  const remove = (list: string[], name: string) => {
    const index = list.indexOf(name);
    if (index >= 0) list.splice(index, 1);
  };
  const env: SiteDataEnv = {
    local,
    session,
    databaseNames: async () => [...dbs],
    deleteDatabase: async (name) => remove(dbs, name),
    cacheNames: async () => [...caches],
    deleteCache: async (name) => remove(caches, name),
  };
  return Object.assign(env, { localKeys: () => keysOf(local), dbs: () => [...dbs], caches: () => [...caches] });
}

const env = () =>
  fakeEnv({
    local: [
      "__g|https://a.test|k",
      "__g|https://cdn.a.test|k",
      "__g|https://b.test|k",
      "__g|https://xa.test|k",
      "__g|https://a.test.evil|k",
      "girici:settings",
      "__g|garbage",
    ],
    session: ["__g|https://s.test|x"],
    dbs: ["__g|https://d.test|store", "__g|https://a.test|store", "__girici"],
    caches: ["__g|https://c.test|v1", "girici:rw"],
  });

describe("site partitions", () => {
  it("finds the origins behind every kind of partition", async () => {
    expect(await partitionOrigins(env())).toEqual([
      "https://a.test",
      "https://a.test.evil",
      "https://b.test",
      "https://c.test",
      "https://cdn.a.test",
      "https://d.test",
      "https://s.test",
      "https://xa.test",
    ]);
  });

  it("clears a site and its subdomains, nothing else", async () => {
    const e = env();
    await clearPartitions(e, "a.test");
    expect(e.localKeys()).toEqual([
      "__g|https://b.test|k",
      "__g|https://xa.test|k",
      "__g|https://a.test.evil|k",
      "girici:settings",
      "__g|garbage",
    ]);
    expect(e.dbs()).toEqual(["__g|https://d.test|store", "__girici"]);
  });

  it("clears a site's data in other sites' partitions and their partitions under it", async () => {
    const e = fakeEnv({
      local: ["__g^|https://x.test|https://a.test|k", "__g^|https://a.test|https://x.test|k", "__g|https://x.test|k"],
      dbs: ["__g^|https://www.a.test|https://x.test|db", "__g^|https://x.test|https://y.test|db"],
    });
    await clearPartitions(e, "a.test");
    expect(e.localKeys()).toEqual(["__g|https://x.test|k"]);
    expect(e.dbs()).toEqual(["__g^|https://x.test|https://y.test|db"]);
  });

  it("never touches Girici's own stores, even when clearing everything", async () => {
    const e = env();
    await clearPartitions(e, null);
    expect(e.localKeys()).toEqual(["girici:settings", "__g|garbage"]);
    expect(e.dbs()).toEqual(["__girici"]);
    expect(e.caches()).toEqual(["girici:rw"]);
  });

  it("reads partition names strictly", () => {
    expect(partitionOrigin("__g|https://a.test|k|with|bars")).toBe("https://a.test");
    expect(partitionOrigin("__g|garbage")).toBeNull();
    expect(partitionOrigin("__g|javascript:alert(1)|k")).toBeNull();
    expect(partitionOrigin("girici:settings")).toBeNull();
  });
});
