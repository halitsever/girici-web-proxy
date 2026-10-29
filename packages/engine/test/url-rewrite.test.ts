import { describe, expect, it } from "vitest";
import { rewriteSrcset, rewriteUrl, unrewriteUrl } from "../src/shared/url-rewrite.ts";

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
      "javascript:void(0)",
      "ftp://x.test/",
      "http://[::1",
    ]) {
      expect(rewriteUrl(raw, base, origin)).toBe(raw);
    }
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
    expect(rewriteUrl("java\nscript:void(0)", base, origin)).toBe("java\nscript:void(0)");
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
