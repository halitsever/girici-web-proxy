import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { PrefsService, readPrefsMessage } from "../src/sw/prefs.ts";

const ui = { id: "ui-1", type: "window", frameType: "top-level", url: "https://girici.test/settings" };
const known = new Set(["ui-1"]);
const origin = "https://girici.test";
const valid = { type: "girici:prefs", v: PROTOCOL_VERSION, blockThirdPartyCookies: false };

describe("PrefsService", () => {
  it("blocks third-party cookies until told otherwise, and remembers a change", async () => {
    const saved: unknown[] = [];
    const prefs = new PrefsService({ load: async () => undefined, save: async (value) => void saved.push(value) });
    await prefs.ready();
    expect(prefs.current()).toEqual({ blockThirdPartyCookies: true, sealAddresses: false, instanceSeal: false });
    await prefs.set({ blockThirdPartyCookies: false });
    expect(prefs.current()).toEqual({ blockThirdPartyCookies: false, sealAddresses: false, instanceSeal: false });
    expect(saved).toEqual([{ blockThirdPartyCookies: false, sealAddresses: false, instanceSeal: false }]);
  });

  it("loads a stored choice and survives a broken store", async () => {
    const stored = new PrefsService({ load: async () => ({ blockThirdPartyCookies: false }), save: async () => {} });
    await stored.ready();
    expect(stored.current().blockThirdPartyCookies).toBe(false);
    const broken = new PrefsService({
      load: async () => {
        throw new Error("no idb");
      },
      save: async () => {
        throw new Error("no idb");
      },
    });
    await broken.ready();
    expect(broken.current().blockThirdPartyCookies).toBe(true);
    await broken.set({ blockThirdPartyCookies: false });
    expect(broken.current().blockThirdPartyCookies).toBe(false);
  });

  it("loads stored sealing switches and drops malformed ones", async () => {
    const stored = new PrefsService({
      load: async () => ({ blockThirdPartyCookies: true, sealAddresses: true, instanceSeal: "yes" }),
      save: async () => {},
    });
    await stored.ready();
    expect(stored.current()).toEqual({ blockThirdPartyCookies: true, sealAddresses: true, instanceSeal: false });
  });
});

describe("readPrefsMessage", () => {
  it("keeps the sealing switches the UI sends", () => {
    expect(readPrefsMessage({ ...valid, sealAddresses: true, instanceSeal: "yes" }, ui, origin, known)).toEqual({
      blockThirdPartyCookies: false,
      sealAddresses: true,
    });
    expect(readPrefsMessage({ ...valid, instanceSeal: true }, ui, origin, known)).toEqual({
      blockThirdPartyCookies: false,
      instanceSeal: true,
    });
  });

  it("takes the setting only from the Girici UI", () => {
    expect(readPrefsMessage(valid, ui, origin, known)).toEqual({ blockThirdPartyCookies: false });
    expect(
      readPrefsMessage(valid, { ...ui, url: "https://girici.test/~/https/tracker.example/" }, origin, known),
    ).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, url: "https://evil.example/settings" }, origin, known)).toBeNull();
    expect(
      readPrefsMessage(
        valid,
        { id: "ui-1", type: "worker", frameType: "none", url: "blob:https://girici.test/1" },
        origin,
        known,
      ),
    ).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, frameType: "nested" }, origin, known)).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, url: "blob:https://girici.test/1" }, origin, known)).toBeNull();
    expect(readPrefsMessage(valid, null, origin, known)).toBeNull();
    expect(readPrefsMessage({ ...valid, v: 0 }, ui, origin, known)).toBeNull();
    expect(readPrefsMessage({ ...valid, blockThirdPartyCookies: "no" }, ui, origin, known)).toBeNull();
  });

  it("ignores a window on a UI address that no UI navigation produced", () => {
    expect(readPrefsMessage(valid, { ...ui, id: "page-7" }, origin, known)).toBeNull();
  });
});
