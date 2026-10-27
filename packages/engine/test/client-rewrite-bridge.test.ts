import { describe, expect, it } from "vitest";
import { createRewriteBridge } from "../src/client/rewrite-bridge.ts";

const ctx = {
  origin: "http://proxy.test",
  realUrl: () => new URL("https://site.test/a/b"),
  realBase: () => new URL("https://site.test/a/b"),
  toProxy: (raw: string) => `/~/https/site.test/${raw}`,
  fromProxy: (value: string) => value.replace("/~/https/site.test/", "https://site.test/"),
};

describe("createRewriteBridge", () => {
  it("rewrites js, html, specifiers and meta urls through the context", () => {
    const bridge = createRewriteBridge(ctx);
    expect(bridge.js("location.href")).toBe("__g$.L(location).href");
    expect(bridge.html('<a href="https://other.test/">x</a>')).toContain("/~/https/other.test/");
    expect(bridge.importSpecifier("mod.js")).toBe("/~/https/site.test/mod.js");
    expect(bridge.metaUrl("/~/https/site.test/a/b")).toBe("https://site.test/a/b");
  });

  it("restores real urls in html the page reads back", () => {
    const bridge = createRewriteBridge(ctx);
    expect(bridge.unhtml('<a href="/~/https/site.test/x">y</a>')).toBe('<a href="https://site.test/x">y</a>');
  });
});
