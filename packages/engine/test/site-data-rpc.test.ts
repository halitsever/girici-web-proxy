import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { CookieService, type CookieRecordStore } from "../src/sw/cookies/jar.ts";
import { callerOf, handleSiteData } from "../src/sw/site-data.ts";

function memoryStore(): CookieRecordStore {
  const records = new Map<string, unknown>();
  return {
    loadAll: async () => [...records].map(([key, value]) => ({ key, value })),
    write: async (puts, deletes) => {
      for (const { key, value } of puts) records.set(key, value);
      for (const key of deletes) records.delete(key);
    },
  };
}

async function jarWith(): Promise<CookieService> {
  const jar = new CookieService(memoryStore(), { flushDelay: 0 });
  await jar.ready();
  const ctx = { initiator: null, credentials: "include", topLevel: true, method: "GET" } as const;
  await jar.store(new URL("https://www.a.test/"), ["a=1; Domain=a.test"], ctx);
  await jar.store(new URL("https://b.test/"), ["b=1"], ctx);
  return jar;
}

const rpc = (body: Record<string, unknown>) =>
  new Request("https://girici.test/_g/rpc/site-data", {
    method: "POST",
    body: JSON.stringify({ v: PROTOCOL_VERSION, ...body }),
  });

describe("handleSiteData", () => {
  it("lists sites for the Girici UI, merging cookies and storage origins", async () => {
    const res = await handleSiteData(
      rpc({ op: "list", origins: ["https://cdn.a.test", "https://c.test"] }),
      { kind: "ui" },
      await jarWith(),
    );
    expect(await res.json()).toEqual({
      sites: [
        { site: "a.test", cookies: 1, origins: ["https://cdn.a.test"] },
        { site: "b.test", cookies: 1, origins: [] },
        { site: "c.test", cookies: 0, origins: ["https://c.test"] },
      ],
    });
  });

  it("lets a proxied page clear only its own site", async () => {
    const jar = await jarWith();
    const res = await handleSiteData(
      rpc({ op: "clear", site: "b.test" }),
      { kind: "page", url: new URL("https://www.a.test/x") },
      jar,
    );
    expect(await res.json()).toEqual({ site: "a.test", cookies: 1 });
    expect(await jar.siteCookieCounts()).toEqual(new Map([["b.test", 1]]));
  });

  it("refuses listing and clearing everything to proxied pages and unknown callers", async () => {
    const page = { kind: "page", url: new URL("https://a.test/") } as const;
    expect((await handleSiteData(rpc({ op: "list", origins: [] }), page, await jarWith())).status).toBe(403);
    expect((await handleSiteData(rpc({ op: "clear-all" }), page, await jarWith())).status).toBe(403);
    expect(
      (await handleSiteData(rpc({ op: "clear", site: "a.test" }), { kind: "other" }, await jarWith())).status,
    ).toBe(403);
  });

  it("rejects an old protocol version and a site that is not a registrable domain", async () => {
    const old = new Request("https://girici.test/_g/rpc/site-data", {
      method: "POST",
      body: JSON.stringify({ v: 0, op: "clear-all" }),
    });
    expect((await handleSiteData(old, { kind: "ui" }, await jarWith())).status).toBe(409);
    expect(
      (await handleSiteData(rpc({ op: "clear", site: "www.a.test" }), { kind: "ui" }, await jarWith())).status,
    ).toBe(400);
  });
});

describe("callerOf", () => {
  const origin = "https://girici.test";
  const ui = { type: "window", frameType: "top-level", url: `${origin}/settings` };

  it("gives Girici UI authority only to a top-level UI window", () => {
    expect(callerOf(ui, origin)).toEqual({ kind: "ui" });
    expect(callerOf({ ...ui, frameType: "nested" }, origin)).toEqual({ kind: "other" });
    expect(callerOf({ ...ui, frameType: "auxiliary" }, origin)).toEqual({ kind: "other" });
    expect(callerOf({ type: "worker", frameType: "none", url: `blob:${origin}/1234` }, origin)).toEqual({
      kind: "other",
    });
    expect(callerOf({ ...ui, url: "https://evil.example/settings" }, origin)).toEqual({ kind: "other" });
    expect(callerOf({ ...ui, url: `blob:${origin}/1` }, origin)).toEqual({ kind: "other" });
    expect(callerOf(undefined, origin)).toEqual({ kind: "other" });
  });

  it("names a proxied window by its real address, framed or not", () => {
    expect(callerOf({ type: "window", frameType: "nested", url: `${origin}/~/https/a.test/x` }, origin)).toEqual({
      kind: "page",
      url: new URL("https://a.test/x"),
    });
  });
});
