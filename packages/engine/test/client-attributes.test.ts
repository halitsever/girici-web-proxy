import { describe, expect, it } from "vitest";
import { restoreAttribute, rewriteAttribute } from "../src/client/attribute-values.ts";

const base = new URL("https://site.test/dir/page.html");
const origin = "http://proxy.test";

describe("rewriteAttribute", () => {
  it("rewrites URL and srcset attributes only", () => {
    expect(rewriteAttribute("a", "href", "https://other.test/x", base, origin)).toBe("/~/https/other.test/x");
    expect(rewriteAttribute("img", "srcset", "https://c.test/a.png 1x", base, origin)).toBe("/~/https/c.test/a.png 1x");
    expect(rewriteAttribute("object", "data", "//x.test/a", base, origin)).toBe("/~/https/x.test/a");
    expect(rewriteAttribute("div", "data", "//x.test/a", base, origin)).toBe("//x.test/a");
    expect(rewriteAttribute("a", "title", "https://other.test/x", base, origin)).toBe("https://other.test/x");
  });
});

describe("restoreAttribute", () => {
  it("shows real URLs for values the proxy rewrote", () => {
    expect(restoreAttribute("a", "href", "/~/https/other.test/x", base, origin)).toBe("https://other.test/x");
    expect(restoreAttribute("a", "href", "http://proxy.test/~/https/other.test/y", base, origin)).toBe(
      "https://other.test/y",
    );
    expect(restoreAttribute("img", "srcset", "/~/https/c.test/a.png 1x, b.png 2x", base, origin)).toBe(
      "https://c.test/a.png 1x, b.png 2x",
    );
    expect(restoreAttribute("a", "href", "rel/x", base, origin)).toBe("rel/x");
  });
});
