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
    await flush();
    expect(["a", "b", "c"].map((id) => ui.has(id))).toEqual([false, true, true]);
  });

  it("drops clients whose window has closed before open ones", async () => {
    const live = async () => new Set(["a", "c"]);
    const ui = new UiClients(memoryRecords(), { limit: 2, liveIds: live });
    await ui.ready();
    for (const id of ["a", "b", "c"]) ui.add(id);
    await flush();
    expect(["a", "b", "c"].map((id) => ui.has(id))).toEqual([true, false, true]);
  });

  it("keeps an open UI tab while a page floods UI loads", async () => {
    const ui = new UiClients(memoryRecords(), { limit: 3, liveIds: async () => new Set(["tab"]) });
    await ui.ready();
    ui.add("tab");
    for (let i = 0; i < 20; i++) ui.add(`flood-${i}`);
    await flush();
    expect([ui.has("tab"), ui.has("flood-0"), ui.has("flood-19")]).toEqual([true, false, true]);
  });

  it("keeps a new load whose page has not arrived over older closed clients", async () => {
    const records = memoryRecords();
    await records.put("ui", "old-1", 1);
    await records.put("ui", "old-2", 2);
    const ui = new UiClients(records, { limit: 2, liveIds: async () => new Set() });
    await ui.ready();
    ui.add("new");
    await flush();
    expect(["old-1", "old-2", "new"].map((id) => ui.has(id))).toEqual([false, true, true]);
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

  it("seeds nothing when it cannot store the marker", async () => {
    const records = memoryRecords();
    const ui = new UiClients({
      ...records,
      put: async (store, key, value) => {
        if (key === "#seeded") throw new Error("quota");
        await records.put(store, key, value);
      },
    });
    await ui.seedOnce([{ id: "s", type: "window", frameType: "top-level", url: `${origin}/settings` }], origin);
    expect(ui.has("s")).toBe(false);
  });

  it("reads its records again after a failed read, and still does not seed", async () => {
    const records = memoryRecords();
    await records.put("ui", "old", 1);
    let failures = 1;
    const ui = new UiClients({
      ...records,
      load: async (store) => {
        if (failures-- > 0) throw new Error("busy");
        return records.load(store);
      },
    });
    const window = { id: "s", type: "window", frameType: "top-level", url: `${origin}/settings` };
    await ui.seedOnce([window], origin);
    expect([ui.has("old"), ui.has("s")]).toEqual([false, false]);
    await ui.ready();
    await ui.seedOnce([window], origin);
    expect([ui.has("old"), ui.has("s")]).toEqual([true, false]);
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

  it("never counts a load as the UI on a site host", () => {
    expect(loadsUi(nav, new URL(`${origin}/settings`), origin, true)).toBe(false);
    expect(loadsUi(nav, new URL(`${origin}/`), origin, true)).toBe(false);
  });
});
