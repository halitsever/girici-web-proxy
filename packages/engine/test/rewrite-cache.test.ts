import { describe, expect, it } from "vitest";
import { cacheKey, RewriteMemo } from "../src/sw/rewrite-cache.ts";

describe("rewrite cache", () => {
  it("keys by version, kind and validators and reuses the rewrite", () => {
    const memo = new RewriteMemo();
    const key = cacheKey(new URL("https://s.test/a.js"), "js", { etag: 'W/"1"', lastModified: null, length: "10" });
    expect(key).not.toBeNull();
    expect(memo.get(key as string)).toBeNull();
    memo.set(key as string, "rewritten");
    expect(memo.get(key as string)).toBe("rewritten");
    const other = cacheKey(new URL("https://s.test/a.js"), "js", { etag: 'W/"2"', lastModified: null, length: "10" });
    expect(memo.get(other as string)).toBeNull();
  });

  it("returns no key without a validator", () => {
    expect(cacheKey(new URL("https://s.test/a.js"), "js", { etag: null, lastModified: null, length: null })).toBeNull();
  });

  it("forgets the least recently used rewrite beyond its budget", () => {
    const memo = new RewriteMemo(40);
    memo.set("a", "0123456789");
    memo.set("b", "0123456789");
    memo.get("a");
    memo.set("c", "0123456789");
    expect(memo.get("b")).toBeNull();
    expect(memo.get("a")).not.toBeNull();
    expect(memo.get("c")).not.toBeNull();
  });
});
