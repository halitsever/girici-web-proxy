import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { PrefsService, readPrefsMessage } from "../src/sw/prefs.ts";

const ui = { type: "window", frameType: "top-level", url: "https://girici.test/settings" };
const origin = "https://girici.test";
const valid = { type: "girici:prefs", v: PROTOCOL_VERSION, blockThirdPartyCookies: false };

describe("PrefsService", () => {
  it("blocks third-party cookies until told otherwise, and remembers a change", async () => {
    const saved: unknown[] = [];
    const prefs = new PrefsService({ load: async () => undefined, save: async (value) => void saved.push(value) });
    await prefs.ready();
    expect(prefs.current()).toEqual({ blockThirdPartyCookies: true });
    await prefs.set({ blockThirdPartyCookies: false });
    expect(prefs.current()).toEqual({ blockThirdPartyCookies: false });
    expect(saved).toEqual([{ blockThirdPartyCookies: false }]);
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
});

describe("readPrefsMessage", () => {
  it("takes the setting only from the Girici UI", () => {
    expect(readPrefsMessage(valid, ui, origin)).toEqual({ blockThirdPartyCookies: false });
    expect(readPrefsMessage(valid, { ...ui, url: "https://girici.test/~/https/tracker.example/" }, origin)).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, url: "https://evil.example/settings" }, origin)).toBeNull();
    expect(
      readPrefsMessage(valid, { type: "worker", frameType: "none", url: "blob:https://girici.test/1" }, origin),
    ).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, frameType: "nested" }, origin)).toBeNull();
    expect(readPrefsMessage(valid, { ...ui, url: "blob:https://girici.test/1" }, origin)).toBeNull();
    expect(readPrefsMessage(valid, null, origin)).toBeNull();
    expect(readPrefsMessage({ ...valid, v: 0 }, ui, origin)).toBeNull();
    expect(readPrefsMessage({ ...valid, blockThirdPartyCookies: "no" }, ui, origin)).toBeNull();
  });
});
