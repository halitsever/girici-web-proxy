import { describe, expect, it, vi } from "vitest";
import {
  COOKIE_LIMITS,
  CookieService,
  type CookieRecordStore,
  type CookieRequestContext,
} from "../src/sw/cookies/jar.ts";
import type { CookieSnapshot } from "../src/shared/protocol.ts";

function memoryStore() {
  const records = new Map<string, unknown>();
  const store: CookieRecordStore = {
    loadAll: async () => [...records].map(([key, value]) => ({ key, value })),
    write: async (puts, deletes) => {
      for (const { key, value } of puts) records.set(key, value);
      for (const key of deletes) records.delete(key);
    },
  };
  return { store, records };
}

async function service(store = memoryStore().store) {
  const jar = new CookieService(store, { flushDelay: 0 });
  await jar.ready();
  return jar;
}

const nav = (initiator: string | null = null): CookieRequestContext => ({
  initiator: initiator ? new URL(initiator) : null,
  credentials: "include",
  topLevel: true,
  method: "GET",
});
const sub = (initiator: string): CookieRequestContext => ({ ...nav(initiator), topLevel: false });

describe("CookieService", () => {
  it("sends cookies back to the site that set them and to nobody else", async () => {
    const jar = await service();
    await jar.store(
      new URL("https://www.site-a.test/login"),
      ["sid=abc; HttpOnly; Path=/", "theme=dark; Domain=site-a.test; Path=/"],
      nav(),
    );
    expect(await jar.header(new URL("https://www.site-a.test/home"), nav())).toBe("sid=abc; theme=dark");
    expect(await jar.header(new URL("https://cdn.site-a.test/x"), sub("https://www.site-a.test/"))).toBe("theme=dark");
    expect(await jar.header(new URL("https://site-b.test/"), nav())).toBeNull();
  });

  it("keeps lax and strict cookies out of cross-site subresources", async () => {
    const jar = await service();
    await jar.store(
      new URL("https://site-a.test/"),
      ["lax=1; SameSite=Lax", "none=1; SameSite=None; Secure", "plain=1"],
      nav(),
    );
    expect(await jar.header(new URL("https://site-a.test/pixel"), sub("https://site-b.test/"))).toBe("none=1; plain=1");
    expect(await jar.header(new URL("https://site-a.test/"), nav("https://site-b.test/"))).toBe(
      "lax=1; none=1; plain=1",
    );
  });

  it("ignores cookies when credentials are omitted", async () => {
    const jar = await service();
    const omit: CookieRequestContext = { ...nav(), credentials: "omit" };
    await jar.store(new URL("https://site-a.test/"), ["a=1"], omit);
    expect(await jar.header(new URL("https://site-a.test/"), nav())).toBeNull();
    await jar.store(new URL("https://site-a.test/"), ["a=1"], nav());
    expect(await jar.header(new URL("https://site-a.test/"), omit)).toBeNull();
  });

  it("lets scripts see and set only non-HttpOnly cookies", async () => {
    const jar = await service();
    const changes = await jar.store(new URL("https://site-a.test/"), ["sid=1; HttpOnly", "theme=dark"], nav());
    expect(changes.map((c) => c.name)).toEqual(["theme"]);
    await jar.setFromScript(new URL("https://site-a.test/page"), "js=1; path=/");
    await jar.setFromScript(new URL("https://site-a.test/page"), "evil=1; HttpOnly");
    expect((await jar.snapshot(new URL("https://site-a.test/page"))).map((c) => `${c.name}=${c.value}`)).toEqual([
      "theme=dark",
      "js=1",
    ]);
  });

  it("never reports HttpOnly cookies to change listeners", async () => {
    const jar = await service();
    const heard: CookieSnapshot[][] = [];
    jar.onChange((changes) => heard.push(changes));
    await jar.store(new URL("https://site-a.test/"), ["s=1; HttpOnly", "v=2"], nav());
    expect(heard).toHaveLength(1);
    expect(heard[0]?.map((c) => c.name)).toEqual(["v"]);
  });

  it("persists cookies and restores them", async () => {
    const { store, records } = memoryStore();
    const jar = await service(store);
    await jar.store(new URL("https://site-a.test/"), ["a=1; Max-Age=3600", "gone=1; Max-Age=3600"], nav());
    await jar.store(new URL("https://site-a.test/"), ["gone=; Max-Age=0"], nav());
    await jar.flush();
    expect([...records.keys()]).toEqual(["site-a.test|/|a"]);
    const restored = await service(store);
    expect(await restored.header(new URL("https://site-a.test/"), nav())).toBe("a=1");
  });

  it("enforces size and count limits", async () => {
    expect(COOKIE_LIMITS).toEqual({ perCookie: 4096, perSite: 180, total: 5000 });
    const jar = await service();
    const site = new URL("https://site-a.test/");
    await jar.store(site, [`big=${"x".repeat(COOKIE_LIMITS.perCookie)}`], nav());
    expect(await jar.header(site, nav())).toBeNull();
    for (let i = 0; i <= COOKIE_LIMITS.perSite; i++) await jar.store(site, [`c${i}=1`], nav());
    const sent = ((await jar.header(site, nav())) ?? "").split("; ");
    expect(sent).toHaveLength(COOKIE_LIMITS.perSite);
    expect(sent).not.toContain("c0=1");
  });

  it("keeps working when persistence fails", async () => {
    let failingWrites = 1;
    const records = new Map<string, unknown>();
    const jar = new CookieService(
      {
        loadAll: async () => {
          throw new Error("broken database");
        },
        write: async (puts) => {
          if (failingWrites-- > 0) throw new Error("quota exceeded");
          for (const { key, value } of puts) records.set(key, value);
        },
      },
      { flushDelay: 0 },
    );
    await jar.ready();
    const site = new URL("https://site-a.test/");
    await jar.store(site, ["a=1"], nav());
    await jar.flush();
    await jar.store(site, ["b=1"], nav());
    await jar.flush();
    expect(await jar.header(site, nav())).toBe("a=1; b=1");
    expect([...records.keys()].sort()).toEqual(["site-a.test|/|a", "site-a.test|/|b"]);
  });

  it("counts cookies per site and clears one site with its subdomains", async () => {
    const jar = await service();
    await jar.store(new URL("https://www.a.test/"), ["x=1; Domain=a.test", "h=1; HttpOnly"], nav());
    await jar.store(new URL("https://b.test/"), ["y=1"], nav());
    expect(await jar.siteCookieCounts()).toEqual(
      new Map([
        ["a.test", 2],
        ["b.test", 1],
      ]),
    );
    const changes: CookieSnapshot[][] = [];
    jar.onChange((change) => changes.push(change));
    expect(await jar.clearSite("a.test")).toBe(2);
    expect(await jar.siteCookieCounts()).toEqual(new Map([["b.test", 1]]));
    expect(changes.flat().map((cookie) => [cookie.name, cookie.expires])).toEqual([["x", 0]]);
  });

  it("tells when the cookies stored so far have reached the store", async () => {
    vi.useFakeTimers();
    try {
      const { store, records } = memoryStore();
      const jar = new CookieService(store, { flushDelay: 50 });
      await jar.ready();
      await jar.saved();
      await jar.store(new URL("https://a.test/"), ["x=1"], nav());
      let saved = false;
      void jar.saved().then(() => (saved = true));
      await vi.advanceTimersByTimeAsync(49);
      expect([saved, records.size]).toEqual([false, 0]);
      await vi.advanceTimersByTimeAsync(1);
      expect([saved, records.size]).toEqual([true, 1]);

      await jar.store(new URL("https://a.test/"), ["y=1"], nav());
      const early = jar.saved();
      await jar.flush();
      await early;
      expect(records.size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists a full clear", async () => {
    const { store, records } = memoryStore();
    const jar = await service(store);
    await jar.store(new URL("https://b.test/"), ["y=1"], nav());
    await jar.flush();
    await jar.clearSite(null);
    expect(records.size).toBe(0);
  });
});
