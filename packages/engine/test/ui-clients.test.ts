import { describe, expect, it } from "vitest";
import type { ClientRecordStore } from "../src/sw/client-records.ts";
import { isUiNavigation, loadsUi, UiClients } from "../src/sw/ui-clients.ts";

const origin = "https://girici.test";

function memoryRecords(): ClientRecordStore {
  const stores = { ui: new Map<string, unknown>(), workers: new Map<string, unknown>() };
  return {
    load: async (store) => [...stores[store]].map(([key, value]) => ({ key, value })),
    put: async (store, key, value) => void stores[store].set(key, value),
    delete: async (store, key) => void stores[store].delete(key),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("UiClients", () => {
  it("remembers UI clients across a restart", async () => {
    const records = memoryRecords();
    const first = new UiClients(records);
    await first.ready();
    first.add("ui-1");
    await flush();
    const again = new UiClients(records);
    await again.ready();
    expect(again.has("ui-1")).toBe(true);
  });

  it("seeds UI windows once, on the first activation", async () => {
    const records = memoryRecords();
    const ui = new UiClients(records);
    await ui.ready();
    await ui.seedOnce(
      [
        { id: "s", type: "window", frameType: "top-level", url: `${origin}/settings` },
        { id: "f", type: "window", frameType: "nested", url: `${origin}/settings` },
        { id: "p", type: "window", frameType: "top-level", url: `${origin}/~/https/a.test/` },
      ],
      origin,
    );
    await ui.seedOnce([{ id: "late", type: "window", frameType: "top-level", url: `${origin}/` }], origin);
    expect(["s", "f", "p", "late"].map((id) => ui.has(id))).toEqual([true, false, false, false]);
    expect(ui.has("#seeded")).toBe(false);
  });

  it("does not seed again after a restart", async () => {
    const records = memoryRecords();
    const first = new UiClients(records);
    await first.ready();
    await first.seedOnce([], origin);
    const again = new UiClients(records);
    await again.ready();
    await again.seedOnce([{ id: "late", type: "window", frameType: "top-level", url: `${origin}/` }], origin);
    expect(again.has("late")).toBe(false);
  });

  it("drops the oldest client beyond its limit", async () => {
    const ui = new UiClients(memoryRecords(), { limit: 2 });
    await ui.ready();
    for (const id of ["a", "b", "c"]) ui.add(id);
    expect(["a", "b", "c"].map((id) => ui.has(id))).toEqual([false, true, true]);
  });

  it("keeps the newest clients when it reloads more than its limit", async () => {
    const records = memoryRecords();
    const first = new UiClients(records, { limit: 2 });
    await first.ready();
    for (const id of ["a", "b", "c"]) first.add(id);
    await flush();
    const again = new UiClients(records, { limit: 2 });
    await again.ready();
    expect(["a", "b", "c"].map((id) => again.has(id))).toEqual([false, true, true]);
  });

  it("keeps a client added while its records were still loading", async () => {
    const records = memoryRecords();
    await records.put("ui", "old", 1);
    const ui = new UiClients(records);
    const loading = ui.ready();
    ui.add("new");
    await loading;
    expect([ui.has("old"), ui.has("new")]).toEqual([true, true]);
  });

  it("starts empty and seeds nothing when its records cannot be read", async () => {
    const broken: ClientRecordStore = {
      load: async () => {
        throw new Error("no idb");
      },
      put: async () => {
        throw new Error("no idb");
      },
      delete: async () => {
        throw new Error("no idb");
      },
    };
    const ui = new UiClients(broken);
    await ui.ready();
    await ui.seedOnce([{ id: "s", type: "window", frameType: "top-level", url: `${origin}/settings` }], origin);
    expect(ui.has("s")).toBe(false);
    ui.add("ui-1");
    await flush();
    expect(ui.has("ui-1")).toBe(true);
  });
});

describe("isUiNavigation", () => {
  it("knows a UI navigation", () => {
    const nav = { mode: "navigate" as RequestMode, destination: "document" as RequestDestination, method: "GET" };
    expect(isUiNavigation(nav, new URL(`${origin}/Settings/`), origin)).toBe(true);
    expect(isUiNavigation({ ...nav, destination: "iframe" }, new URL(`${origin}/`), origin)).toBe(false);
    expect(isUiNavigation(nav, new URL(`${origin}/~/https/a.test/`), origin)).toBe(false);
  });

  it("ignores other origins, other methods and subresource loads", () => {
    const nav = { mode: "navigate" as RequestMode, destination: "document" as RequestDestination, method: "GET" };
    expect(isUiNavigation(nav, new URL("https://evil.test/settings"), origin)).toBe(false);
    expect(isUiNavigation({ ...nav, method: "POST" }, new URL(`${origin}/_g/login`), origin)).toBe(false);
    expect(isUiNavigation({ ...nav, mode: "cors" }, new URL(`${origin}/settings`), origin)).toBe(false);
  });
});

describe("loadsUi", () => {
  const nav = {
    mode: "navigate" as RequestMode,
    destination: "document" as RequestDestination,
    method: "GET",
    referrer: "",
  };
  const fromPage = { ...nav, referrer: `${origin}/~/https/a.test/x` };

  it("counts UI loads, wherever they come from, when the UI answers them", () => {
    expect(loadsUi(nav, new URL(`${origin}/settings`), origin)).toBe(true);
    expect(loadsUi(fromPage, new URL(`${origin}/`), origin)).toBe(true);
    expect(loadsUi(fromPage, new URL(`${origin}/_g/login`), origin)).toBe(true);
  });

  it("skips a proxied page's load of a UI route that is sent back into its site", () => {
    expect(loadsUi(fromPage, new URL(`${origin}/settings`), origin)).toBe(false);
    expect(loadsUi(fromPage, new URL(`${origin}/account?tab=1`), origin)).toBe(false);
  });
});
