import { describe, expect, it } from "vitest";
import { attributeKind, restoreAttribute, rewriteAttribute } from "../src/client/attribute-values.ts";

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

  it("empties integrity on scripts and links, whose rewritten bodies no longer match the hash", () => {
    expect(rewriteAttribute("script", "integrity", "sha384-abc", base, origin)).toBe("");
    expect(rewriteAttribute("LINK", "Integrity", "sha384-abc", base, origin)).toBe("");
    expect(rewriteAttribute("div", "integrity", "sha384-abc", base, origin)).toBe("sha384-abc");
    expect(restoreAttribute("script", "integrity", "", base, origin)).toBe("");
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

describe("srcdoc", () => {
  it("hands srcdoc to the HTML rewriter", () => {
    expect(attributeKind("IFRAME", "srcdoc")).toBe("html");
    expect(rewriteAttribute("iframe", "srcdoc", "<p>", base, origin, (m) => `[${m}]`)).toBe("[<p>]");
    expect(rewriteAttribute("iframe", "srcdoc", "<p>", base, origin)).toBe("<p>");
    expect(restoreAttribute("iframe", "srcdoc", "[<p>]", base, origin, (m) => m.slice(1, -1))).toBe("<p>");
  });
});
