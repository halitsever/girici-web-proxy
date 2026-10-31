import { describe, expect, it } from "vitest";
import { installHtmlSinks } from "../src/client/html-sinks.ts";
import type { Realm } from "../src/client/url-context.ts";

function setup() {
  const parsed: unknown[][] = [];
  class DOMParser {
    parseFromString(source: string, type: unknown) {
      parsed.push([source, type]);
      return {};
    }
  }
  const win = {
    Element: { prototype: {} },
    Document: { prototype: {} },
    Range: { prototype: {} },
    DOMParser,
  } as unknown as Realm;
  installHtmlSinks(
    win,
    (html) => `[${html}]`,
    (html) => html,
    () => {},
    () => {},
  );
  return { parser: new DOMParser(), parsed };
}

describe("installHtmlSinks", () => {
  it("rewrites DOMParser markup for a type object whose methods lie, and parses the type it checked", () => {
    const { parser, parsed } = setup();
    const type = { toString: () => "text/html", endsWith: () => false };
    parser.parseFromString("<iframe srcdoc=x>", type);
    parser.parseFromString("<a/>", "text/xml");
    expect(parsed).toEqual([
      ["[<iframe srcdoc=x>]", "text/html"],
      ["<a/>", "text/xml"],
    ]);
  });
});
