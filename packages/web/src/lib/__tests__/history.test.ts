import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHistory } from "../history";

function stored(raw: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => raw });
}

afterEach(() => vi.unstubAllGlobals());

describe("loadHistory", () => {
  it("keeps the sites a visitor opened", () => {
    const visits = [
      { name: "en.wikipedia.org", t: 2 },
      { name: "https://github.com/halitsever", t: 1 },
    ];
    stored(JSON.stringify(visits));
    expect(loadHistory()).toEqual(visits);
  });

  it("drops entries that open nothing, such as searches an older version saved", () => {
    stored(
      JSON.stringify([
        { name: "Search DuckDuckGo for “cats”", t: 3 },
        { name: "github.com", t: 2 },
        { name: 5, t: 1 },
        { name: "archive.org" },
        null,
      ]),
    );
    expect(loadHistory()).toEqual([{ name: "github.com", t: 2 }]);
  });
});
