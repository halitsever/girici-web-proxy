import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../settings";

function stored(raw: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => raw });
}

afterEach(() => vi.unstubAllGlobals());

describe("loadSettings", () => {
  it("follows the browser's language until the visitor picks one", () => {
    stored(null);
    expect(loadSettings().lang).toBe("auto");
    stored('{"lang":"fa","newTab":true}');
    expect(loadSettings()).toMatchObject({ lang: "fa", newTab: true });
  });

  it("keeps only a language Girici ships", () => {
    for (const lang of ['"klingon"', '"pt-br"', "5", "null", '"__proto__"']) {
      stored(`{"lang":${lang},"toolbar":false}`);
      expect(loadSettings(), lang).toMatchObject({ lang: "auto", toolbar: false });
    }
  });
});
