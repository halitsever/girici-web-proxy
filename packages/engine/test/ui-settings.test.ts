import { describe, expect, it } from "vitest";
import { readToolbarPrefs } from "../src/shared/ui-settings.ts";
import { withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

describe("readToolbarPrefs", () => {
  it("defaults to a visible toolbar and DuckDuckGo", () => {
    expect(readToolbarPrefs(null)).toEqual({ toolbar: true, engine: "DuckDuckGo" });
  });

  it("reads the saved choices and ignores junk", () => {
    expect(readToolbarPrefs('{"toolbar":false,"engine":"Bing"}')).toEqual({ toolbar: false, engine: "Bing" });
    expect(readToolbarPrefs('{"engine":"Altavista"}').engine).toBe("DuckDuckGo");
    expect(readToolbarPrefs("{")).toEqual({ toolbar: true, engine: "DuckDuckGo" });
  });

  it("parses with natives taken at load and reads only the saved fields", () => {
    const additions = {
      toolbar: { value: false, writable: true },
      engine: { value: "Bing", writable: true },
    };
    const read = () => readToolbarPrefs('{"engine":"Google"}');
    const parsed = withReplaced(JSON, "parse", { value: () => ({ toolbar: false }) }, () =>
      withPrototypeAdditions(additions, read),
    );
    expect(parsed).toEqual({ toolbar: true, engine: "Google" });
  });
});
