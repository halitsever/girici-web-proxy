import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_PREFS, PROTOCOL_VERSION, type EnginePrefs } from "../src/shared/protocol.ts";
import { MasterSealer } from "../src/shared/sealed-address.ts";
import { readInstanceSeal, readSealMessage, Sealing, type KeyStore } from "../src/sw/sealing.ts";

function memoryKeys(stored: Uint8Array | null = null) {
  const state = { key: stored, created: 0 };
  const store: KeyStore = {
    load: async () => state.key,
    loadOrCreate: async (fresh) => {
      if (state.key) return state.key;
      state.created++;
      state.key = fresh();
      return state.key;
    },
  };
  return { store, state };
}

function fakePrefs(initial: Partial<EnginePrefs> = {}) {
  let current: EnginePrefs = { ...DEFAULT_ENGINE_PREFS, ...initial };
  return {
    ready: async () => {},
    current: () => ({ ...current }),
    set(update: Partial<EnginePrefs>) {
      current = { ...current, ...update };
    },
  };
}

const K = new Uint8Array(32).fill(6);
const url = new URL("https://a.test/p?q=1");

describe("Sealing", () => {
  it("creates the key once, on the first seal while sealing is on", async () => {
    const { store, state } = memoryKeys();
    const prefs = fakePrefs();
    const sealing = new Sealing(store, prefs, () => new Uint8Array(32).fill(1));
    await sealing.ready();
    expect(await sealing.sealerFor(false)).toBeNull();
    expect(state.created).toBe(0);
    prefs.set({ sealAddresses: true });
    expect(sealing.enabled()).toBe(true);
    const [first, second] = await Promise.all([sealing.sealerFor(false), sealing.sealerFor(false)]);
    expect(first!.seal(url)).toBe(second!.seal(url));
    expect(state.created).toBe(1);
    expect(sealing.open(first!.seal(url))?.href).toBe(url.href);
  });

  it("counts the instance switch as on", async () => {
    const sealing = new Sealing(memoryKeys().store, fakePrefs({ instanceSeal: true }));
    await sealing.ready();
    expect(sealing.enabled()).toBe(true);
  });

  it("opens sealed addresses with a stored key while sealing is off", async () => {
    const sealing = new Sealing(memoryKeys(K).store, fakePrefs());
    await sealing.ready();
    expect(sealing.open(new MasterSealer(K).seal(url))?.href).toBe(url.href);
    expect(await sealing.sealerFor(true)).not.toBeNull();
    expect(await sealing.sealerFor(false)).toBeNull();
  });

  it("opens nothing without a key", async () => {
    const sealing = new Sealing(memoryKeys().store, fakePrefs());
    await sealing.ready();
    expect(sealing.open("/~/x/a.b")).toBeNull();
    expect(await sealing.sealerFor(true)).toBeNull();
  });

  it("stays plain when the key store fails", async () => {
    const broken: KeyStore = {
      load: async () => {
        throw new Error("no idb");
      },
      loadOrCreate: async () => {
        throw new Error("no idb");
      },
    };
    const sealing = new Sealing(broken, fakePrefs({ sealAddresses: true }));
    await sealing.ready();
    expect(await sealing.sealerFor(false)).toBeNull();
    expect(await sealing.addressFor("/~/https/a.test/p")).toBe("/~/https/a.test/p");
  });

  it("reads the key again after a failed load while sealing is off", async () => {
    let fail = true;
    const flaky: KeyStore = {
      load: async () => {
        if (fail) throw new Error("busy");
        return K;
      },
      loadOrCreate: async () => K,
    };
    const sealing = new Sealing(flaky, fakePrefs());
    await sealing.ready();
    expect(await sealing.sealerFor(true)).toBeNull();
    fail = false;
    await sealing.ready();
    expect(sealing.open(new MasterSealer(K).seal(url))?.href).toBe(url.href);
  });

  it("gives the UI a sealed address while on and its own path while off", async () => {
    const prefs = fakePrefs({ sealAddresses: true });
    const sealing = new Sealing(memoryKeys().store, prefs);
    await sealing.ready();
    const address = await sealing.addressFor("/~/https/a.test/p");
    expect(address).toMatch(/^\/~\/x\//);
    expect(sealing.open(address!)?.href).toBe("https://a.test/p");
    expect(await sealing.addressFor("/settings")).toBeNull();
    expect(await sealing.addressFor("/~/x/a.b")).toBeNull();
    prefs.set({ sealAddresses: false });
    expect(await sealing.addressFor("/~/https/a.test/p")).toBe("/~/https/a.test/p");
  });
});

describe("readSealMessage", () => {
  const origin = "https://girici.test";
  const ui = { id: "ui-1", type: "window", frameType: "top-level", url: "https://girici.test/" };
  const known = new Set(["ui-1"]);
  const valid = { type: "girici:seal", v: PROTOCOL_VERSION, path: "/~/https/a.test/" };

  it("answers only the UI's seal requests", () => {
    expect(readSealMessage(valid, ui, origin, known)).toBe("/~/https/a.test/");
    expect(readSealMessage(valid, { ...ui, url: "https://girici.test/~/https/a.test/" }, origin, known)).toBeNull();
    expect(readSealMessage(valid, { ...ui, id: "page-1" }, origin, known)).toBeNull();
    expect(readSealMessage(valid, null, origin, known)).toBeNull();
    expect(readSealMessage({ ...valid, v: 0 }, ui, origin, known)).toBeNull();
    expect(readSealMessage({ ...valid, path: 5 }, ui, origin, known)).toBeNull();
    expect(readSealMessage({ ...valid, type: "girici:prefs" }, ui, origin, known)).toBeNull();
  });
});

describe("readInstanceSeal", () => {
  it("reads the instance switch from the sign-in state", async () => {
    expect(await readInstanceSeal(async () => Response.json({ sealAddresses: true }))).toBe(true);
    expect(await readInstanceSeal(async () => Response.json({ sealAddresses: false }))).toBe(false);
    expect(await readInstanceSeal(async () => Response.json({}))).toBe(false);
    expect(await readInstanceSeal(async () => new Response("{}", { status: 500 }))).toBeNull();
    expect(await readInstanceSeal(async () => new Response("x"))).toBeNull();
    expect(await readInstanceSeal(async () => Response.json("x"))).toBeNull();
    expect(
      await readInstanceSeal(async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});
