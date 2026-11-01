import type { KeyValueStore, SiteDataEnv } from "@girici/engine/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearedNote,
  clearLegacyRootData,
  clearSites,
  hasLegacyRootData,
  listVisitedSites,
  siteName,
} from "../site-data";

interface FakeStore extends KeyValueStore {
  keys: string[];
}

function fakeStore(keys: string[]): FakeStore {
  const list = [...keys];
  return {
    keys: list,
    get length() {
      return list.length;
    },
    key: (index) => list[index] ?? null,
    removeItem: (key) => {
      const index = list.indexOf(key);
      if (index >= 0) list.splice(index, 1);
    },
  };
}

function fakeEnv(
  init: { local?: string[]; session?: string[]; databases?: string[]; caches?: string[] },
  log: string[] = [],
) {
  const local = fakeStore(init.local ?? []);
  const session = fakeStore(init.session ?? []);
  const databases = [...(init.databases ?? [])];
  const caches = [...(init.caches ?? [])];
  const env: SiteDataEnv = {
    local,
    session,
    databaseNames: async () => [...databases],
    deleteDatabase: async (name) => {
      log.push(`delete database ${name}`);
      databases.splice(databases.indexOf(name), 1);
    },
    cacheNames: async () => [...caches],
    deleteCache: async (name) => {
      log.push(`delete cache ${name}`);
      caches.splice(caches.indexOf(name), 1);
    },
  };
  return { env, local, session, databases, caches };
}

afterEach(() => vi.unstubAllGlobals());

describe("listVisitedSites", () => {
  it("reads the sites the root remembers for this browser", async () => {
    const sites = [{ site: "https://site-a.test", host: "aaa.proxy.test" }];
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return Response.json({ sites });
    }) as typeof fetch;
    expect(await listVisitedSites(fetcher)).toEqual(sites);
    expect(urls).toEqual(["/_g/sites/list"]);
    const failing = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(listVisitedSites(failing)).rejects.toThrow("Could not load the sites you visited.");
  });
});

describe("clearSites", () => {
  function recorder(log: string[], answer: Response) {
    return (async (url: string, init?: RequestInit) => {
      log.push(`${init?.method ?? "GET"} ${url} ${String(init?.body)}`);
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return answer;
    }) as typeof fetch;
  }

  it("plans the chain for every site and follows it", async () => {
    const log: string[] = [];
    const { env } = fakeEnv({ databases: ["__girici"] }, log);
    const start = "//aaa.proxy.test/_g/sites/clear?p=x&s=y&i=0";
    await clearSites("all", {
      siteData: env,
      fetcher: recorder(log, Response.json({ start })),
      assign: (url) => void log.push(`assign ${url}`),
    });
    expect(log).toEqual(["delete database __girici", 'POST /_g/sites/plan {"sites":"all"}', `assign ${start}`]);
  });

  it("plans the chain for the sites asked for", async () => {
    const log: string[] = [];
    await clearSites(["https://site-a.test"], {
      siteData: fakeEnv({}).env,
      fetcher: recorder(log, Response.json({ start: "//aaa.proxy.test/_g/sites/clear?p=x&s=y&i=0" })),
      assign: () => undefined,
    });
    expect(log).toEqual(['POST /_g/sites/plan {"sites":["https://site-a.test"]}']);
  });

  it("stays on Settings when the root refuses the plan", async () => {
    const assigned: string[] = [];
    await expect(
      clearSites("all", {
        siteData: fakeEnv({}).env,
        fetcher: recorder([], new Response(null, { status: 403 })),
        assign: (url) => void assigned.push(url),
      }),
    ).rejects.toThrow("Could not start clearing site data.");
    await expect(
      clearSites("all", {
        siteData: fakeEnv({}).env,
        fetcher: recorder([], Response.json({ start: 5 })),
        assign: (url) => void assigned.push(url),
      }),
    ).rejects.toThrow("Could not start clearing site data.");
    expect(assigned).toEqual([]);
  });
});

describe("legacy root data", () => {
  const leftovers = {
    local: ["__g|https://a.test|k", "girici:settings", "girici:history"],
    session: ["__g^|https://b.test|https://a.test|k", "girici:engine-reload"],
    databases: ["__girici", "__girici_keys", "__g|https://a.test|db", "app"],
    caches: ["girici:/_g/client.x.js", "__g|https://a.test|c"],
  };

  it("removes what single-origin mode left on the root and keeps the UI's own data", async () => {
    const { env, local, session, databases, caches } = fakeEnv(leftovers);
    expect(await hasLegacyRootData(env)).toBe(true);
    await clearLegacyRootData(env);
    expect(local.keys).toEqual(["girici:settings", "girici:history"]);
    expect(session.keys).toEqual(["girici:engine-reload"]);
    expect(databases).toEqual(["app"]);
    expect(caches).toEqual([]);
    expect(await hasLegacyRootData(env)).toBe(false);
  });

  it("finds each kind of leftover on its own", async () => {
    for (const init of [
      { local: ["__g|https://a.test|k"] },
      { databases: ["__girici_prefs"] },
      { databases: ["__girici_clients"] },
      { caches: ["girici:/_g/client.x.js"] },
    ]) {
      expect(await hasLegacyRootData(fakeEnv(init).env), JSON.stringify(init)).toBe(true);
    }
    expect(await hasLegacyRootData(fakeEnv({ local: ["girici:settings"], databases: ["app"] }).env)).toBe(false);
  });

  it("treats stores the browser will not list as empty", async () => {
    const { env } = fakeEnv({});
    const refusing: SiteDataEnv = {
      ...env,
      databaseNames: () => Promise.reject(new Error("private window")),
      cacheNames: () => Promise.reject(new Error("private window")),
    };
    expect(await hasLegacyRootData(refusing)).toBe(false);
    await expect(clearLegacyRootData(refusing)).resolves.toBeUndefined();
  });
});

describe("Settings copy", () => {
  it("counts the sites the clearing chain finished", () => {
    expect(clearedNote("1")).toBe("Cleared 1 site.");
    expect(clearedNote("3")).toBe("Cleared 3 sites.");
    expect(clearedNote("0")).toBe("Cleared 0 sites.");
    for (const bad of [undefined, null, "", "-1", "2x", "1.5", ["2"]]) expect(clearedNote(bad), String(bad)).toBe("");
  });

  it("names a site without its https scheme", () => {
    expect(siteName("https://site-a.test")).toBe("site-a.test");
    expect(siteName("http://site-c.test")).toBe("http://site-c.test");
  });
});
