import { describe, expect, it } from "vitest";
import { readToolbarPrefs } from "../src/shared/ui-settings.ts";

describe("readToolbarPrefs", () => {
  it("defaults to a visible toolbar and DuckDuckGo", () => {
    expect(readToolbarPrefs(null)).toEqual({ toolbar: true, engine: "DuckDuckGo" });
  });

  it("reads the saved choices and ignores junk", () => {
    expect(readToolbarPrefs('{"toolbar":false,"engine":"Bing"}')).toEqual({ toolbar: false, engine: "Bing" });
    expect(readToolbarPrefs('{"engine":"Altavista"}').engine).toBe("DuckDuckGo");
    expect(readToolbarPrefs("{")).toEqual({ toolbar: true, engine: "DuckDuckGo" });
  });
});
