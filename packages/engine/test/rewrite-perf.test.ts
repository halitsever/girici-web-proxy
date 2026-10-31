import { describe, expect, it } from "vitest";
import { rewriteJs } from "../src/rewrite/js.ts";
import { cacheKey, RewriteMemo } from "../src/sw/rewrite-cache.ts";

describe("rewrite performance", () => {
  it("rewrites a base.js-sized bundle within budget", () => {
    const chunk =
      "function a(b){return b.location.href+location.search+eval('1')}var c={location:1};c.location=location.hash;";
    const source = chunk.repeat(Math.ceil((3 * 1024 * 1024) / chunk.length));
    const started = performance.now();
    const output = rewriteJs(source, { standalone: true });
    // A generous bound: locally ~300ms, so it still catches a gross regression without flaking on a loaded CI runner.
    expect(performance.now() - started).toBeLessThan(5000);
    expect(output).toContain("__g$.L(location)");
  });

  it("serves the second rewrite from the memo without re-rewriting", () => {
    const memo = new RewriteMemo();
    const key = cacheKey(new URL("https://s.test/base.js"), "js", { etag: 'W/"1"', lastModified: null, length: "100" });
    let rewrites = 0;
    const rewrite = () => {
      rewrites++;
      return "rewritten";
    };
    const first = memo.get(key as string) ?? rewrite();
    memo.set(key as string, first);
    const second = memo.get(key as string) ?? rewrite();
    expect(second).toBe("rewritten");
    expect(rewrites).toBe(1);
  });
});
