import { describe, expect, it } from "vitest";
import { decodeUrl } from "../src/shared/codec.ts";
import { rewriteJavascriptUrl, rewriteSrcset, rewriteUrl, unrewriteUrl } from "../src/shared/url-rewrite.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const base = new URL("https://site.test/dir/page.html");
const origin = "http://proxy.test";

describe("rewriteUrl", () => {
  it("routes absolute, protocol-relative and root-relative URLs through the proxy", () => {
    expect(rewriteUrl("https://other.test/a?b=1#c", base, origin)).toBe("/~/https/other.test/a?b=1#c");
    expect(rewriteUrl("HTTP://Other.Test:8080/A", base, origin)).toBe("/~/http/other.test:8080/A");
    expect(rewriteUrl("//cdn.test/x.png", base, origin)).toBe("/~/https/cdn.test/x.png");
    expect(rewriteUrl("/root?q=1", base, origin)).toBe("/~/https/site.test/root?q=1");
    expect(rewriteUrl("  https://other.test/  ", base, origin)).toBe("/~/https/other.test/");
  });

  it("keeps relative URLs that already resolve inside the proxy", () => {
    for (const raw of ["img/a.png", "./img/a.png", "../x", "?page=2", "#top", ""]) {
      expect(rewriteUrl(raw, base, origin)).toBe(raw);
    }
  });

  it("rewrites relative URLs that would climb out of the proxy path", () => {
    expect(rewriteUrl("../../../x", base, origin)).toBe("/~/https/site.test/x");
  });

  it("leaves other schemes and unparsable URLs alone", () => {
    for (const raw of [
      "data:image/png;base64,AA",
      "blob:https://site.test/1",
      "mailto:a@b.test",
      "tel:1",
      "about:blank",
      "ftp://x.test/",
      "http://[::1",
    ]) {
      expect(rewriteUrl(raw, base, origin)).toBe(raw);
    }
  });

  it("runs javascript: URLs through the runtime of the window they navigate", () => {
    expect(rewriteUrl("javascript:void(0)", base, origin)).toBe('javascript:__g$.J("void(0)")');
    // The browser drops tabs and newlines, trims the ends and percent-decodes the code, so the helper gets what would run.
    expect(rewriteUrl(" Java\nScript:'<b>%41</b>' ", base, origin)).toBe(`javascript:__g$.J("'<b>A</b>'")`);
    expect(rewriteUrl("javascript:'100%25'", base, origin)).toBe(`javascript:__g$.J("'100%25'")`);
    expect(rewriteUrl("javascript:'%E2%9C%93 %ZZ'", base, origin)).toBe(`javascript:__g$.J("'\u2713 %25ZZ'")`);
  });

  it("wraps a javascript: URL once, and only one that calls the helper with a single string", () => {
    const wrapped = rewriteUrl("javascript:'%'", base, origin);
    expect(rewriteUrl(wrapped, base, origin)).toBe(wrapped);
    const smuggled = `javascript:__g$.J("1"),'<script>x</script>'`;
    expect(rewriteJavascriptUrl(smuggled)).toBe(`javascript:__g$.J(${JSON.stringify(smuggled.slice(11))})`);
    expect(rewriteJavascriptUrl("https://x.test/")).toBeNull();
  });

  it("gives a wrapped javascript: URL back as the page wrote it", () => {
    expect(unrewriteUrl(rewriteUrl("javascript:'50%25 off'", base, origin), base, origin)).toBe("javascript:'50% off'");
  });

  it("is idempotent for URLs that are already ours", () => {
    expect(rewriteUrl("/~/https/other.test/a", base, origin)).toBe("/~/https/other.test/a");
    expect(rewriteUrl("http://proxy.test/~/https/other.test/a", base, origin)).toBe(
      "http://proxy.test/~/https/other.test/a",
    );
  });

  it("maps absolute URLs on our engine and admin paths onto the page's site", () => {
    expect(rewriteUrl("http://proxy.test/_g/admin/settings", base, origin)).toBe(
      "/~/https/site.test/_g/admin/settings",
    );
  });

  it("never throws on URLs or bases that are not web URLs", () => {
    expect(rewriteUrl("java\nscript:void(0)", base, origin)).toBe('javascript:__g$.J("void(0)")');
    expect(rewriteUrl("/x", new URL("ftp://x.test/"), origin)).toBe("/x");
    expect(rewriteUrl("http://proxy.test/other", new URL("about:blank"), origin)).toBe("http://proxy.test/other");
    expect(rewriteUrl("https://other.test/", new URL("about:blank"), origin)).toBe("/~/https/other.test/");
    expect(unrewriteUrl("img/a.png", new URL("about:blank"), origin)).toBe("img/a.png");
  });

  it("maps other paths on our origin onto the page's real origin", () => {
    expect(rewriteUrl("http://proxy.test/other?x=1", base, origin)).toBe("/~/https/site.test/other?x=1");
  });
});

describe("unrewriteUrl", () => {
  it("turns proxy URLs back into real ones", () => {
    expect(unrewriteUrl("http://proxy.test/~/https/other.test/a?b#c", base, origin)).toBe("https://other.test/a?b#c");
    expect(unrewriteUrl("/~/https/other.test/a", base, origin)).toBe("https://other.test/a");
    expect(unrewriteUrl("img/a.png", base, origin)).toBe("https://site.test/dir/img/a.png");
    expect(unrewriteUrl("http://proxy.test/other", base, origin)).toBe("https://site.test/other");
  });

  it("leaves foreign, reserved and non-web URLs alone", () => {
    for (const value of ["https://cdn.test/x", "http://proxy.test/_g/client.js", "data:text/plain,a", "http://[::1"]) {
      expect(unrewriteUrl(value, base, origin)).toBe(value);
    }
  });
});

describe("rewriteSrcset", () => {
  const mark = (url: string) => `[${url}]`;

  it("rewrites each candidate and keeps descriptors", () => {
    expect(rewriteSrcset("a.png 1x, https://c.test/b.png 2x", mark)).toBe("[a.png] 1x, [https://c.test/b.png] 2x");
    expect(rewriteSrcset("  a.png  ,b.png 480w ", mark)).toBe("[a.png], [b.png] 480w");
    expect(rewriteSrcset("data:image/png;base64,AA== 1x", mark)).toBe("[data:image/png;base64,AA==] 1x");
    expect(rewriteSrcset("", mark)).toBe("");
  });
});

describe("with built-ins the page replaced", () => {
  const smuggled = `javascript:__g$.J("1"),'<script>x</script>'`;
  const javascriptCases = () => [
    rewriteUrl(" Java\nScript:'%E2%9C%93 %ZZ \u{1F600}' ", base, origin),
    rewriteJavascriptUrl(smuggled),
    unrewriteUrl(`javascript:__g$.J("'50%2525'")`, base, origin),
  ];
  const javascriptExpected = javascriptCases();
  const JAVASCRIPT_BUILTINS: Array<[string, object, PropertyKey, PropertyDescriptor]> = [
    ...REPLACED_BUILTINS,
    ["JSON.stringify", JSON, "stringify", { value: () => '"");alert(1' }],
    ["JSON.parse", JSON, "parse", { value: () => "x" }],
    ["String.prototype.endsWith", String.prototype, "endsWith", { value: () => true }],
    ["String.prototype.includes", String.prototype, "includes", { value: () => false }],
    ["String.prototype.codePointAt", String.prototype, "codePointAt", { value: () => 0x41 }],
    ["TextDecoder.prototype.decode", TextDecoder.prototype, "decode", { value: () => '"x"' }],
    ["globalThis.parseInt", globalThis, "parseInt", { value: () => 0 }],
  ];
  for (const [name, target, key, replacement] of JAVASCRIPT_BUILTINS) {
    it(`wraps javascript: URLs when ${name} is replaced`, () => {
      expect(withReplaced(target, key, replacement, javascriptCases)).toEqual(javascriptExpected);
    });
  }

  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`keeps proxying URLs when ${name} is replaced`, () => {
      const results = withReplaced(target, key, replacement, () => [
        rewriteUrl("https://other.test/a?b=1", base, origin),
        decodeUrl("/~/https/other.test/a?b=1")?.href,
        unrewriteUrl("/~/https/other.test/a", base, origin),
      ]);
      expect(results).toEqual(["/~/https/other.test/a?b=1", "https://other.test/a?b=1", "https://other.test/a"]);
    });
  }
});
