import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { MasterSealer } from "../src/shared/sealed-address.ts";
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

  it("clears the whole host when a page asks in subdomain mode", async () => {
    const jar = await jarWith();
    const res = await handleSiteData(
      rpc({ op: "clear", site: "b.test" }),
      { kind: "page", url: new URL("https://www.a.test/x") },
      jar,
      true,
    );
    expect(await res.json()).toEqual({ site: "a.test", cookies: 2, all: true });
    expect(await jar.siteCookieCounts()).toEqual(new Map());
  });

  it("still refuses listing and clearing everything to pages in subdomain mode", async () => {
    const page = { kind: "page", url: new URL("https://a.test/") } as const;
    expect((await handleSiteData(rpc({ op: "list", origins: [] }), page, await jarWith(), true)).status).toBe(403);
    expect((await handleSiteData(rpc({ op: "clear-all" }), page, await jarWith(), true)).status).toBe(403);
    expect(
      (await handleSiteData(rpc({ op: "clear", site: "a.test" }), { kind: "other" }, await jarWith(), true)).status,
    ).toBe(403);
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
  const ui = { id: "ui-1", type: "window", frameType: "top-level", url: `${origin}/settings` };
  const known = new Set(["ui-1"]);

  it("gives Girici UI authority only to a top-level UI window", () => {
    expect(callerOf(ui, origin, known)).toEqual({ kind: "ui" });
    expect(callerOf({ ...ui, frameType: "nested" }, origin, known)).toEqual({ kind: "other" });
    expect(callerOf({ ...ui, frameType: "auxiliary" }, origin, known)).toEqual({ kind: "other" });
    expect(
      callerOf({ id: "ui-1", type: "worker", frameType: "none", url: `blob:${origin}/1234` }, origin, known),
    ).toEqual({ kind: "other" });
    expect(callerOf({ ...ui, url: "https://evil.example/settings" }, origin, known)).toEqual({ kind: "other" });
    expect(callerOf({ ...ui, url: `blob:${origin}/1` }, origin, known)).toEqual({ kind: "other" });
    expect(callerOf(undefined, origin, known)).toEqual({ kind: "other" });
  });

  it("gives nothing to a window on a UI address that no UI navigation produced", () => {
    expect(callerOf({ ...ui, id: "page-7" }, origin, known)).toEqual({ kind: "other" });
  });

  it("names a proxied window by its real address, framed or not", () => {
    const framed = { id: "page-1", type: "window", frameType: "nested", url: `${origin}/~/https/a.test/x` };
    expect(callerOf(framed, origin, known)).toEqual({ kind: "page", url: new URL("https://a.test/x") });
  });

  it("knows a sealed page as its own site", () => {
    const master = new MasterSealer(new Uint8Array(32).fill(3));
    const page = new URL("https://a.test/p?q=1");
    const sealed = { id: "page-2", type: "window", frameType: "top-level", url: origin + master.seal(page) };
    const caller = callerOf(sealed, origin, known, master.open);
    expect(caller.kind === "page" && caller.url.href).toBe(page.href);
    expect(callerOf(sealed, origin, known)).toEqual({ kind: "other" });
  });
});
