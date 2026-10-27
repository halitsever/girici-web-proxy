import { describe, expect, it } from "vitest";
import { rewriteJs } from "../src/rewrite/js.ts";
import { cacheKey, readRewritten, writeRewritten, type CacheLike } from "../src/sw/rewrite-cache.ts";

class FakeCache implements CacheLike {
  readonly store = new Map<string, Response>();
  match(request: string): Promise<Response | undefined> {
    return Promise.resolve(this.store.get(request)?.clone());
  }
  put(request: string, response: Response): Promise<void> {
    this.store.set(request, response);
    return Promise.resolve();
  }
}

describe("rewrite performance", () => {
  it("rewrites a base.js-sized bundle within budget", () => {
    const chunk =
      "function a(b){return b.location.href+location.search+eval('1')}var c={location:1};c.location=location.hash;";
    const source = chunk.repeat(Math.ceil((3 * 1024 * 1024) / chunk.length));
    const started = performance.now();
    const output = rewriteJs(source, { standalone: true });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(output).toContain("__g$.L(location)");
  });

  it("serves the second rewrite from the cache without re-rewriting", async () => {
    const cache = new FakeCache();
    const key = cacheKey(new URL("https://s.test/base.js"), "js", { etag: 'W/"1"', lastModified: null, length: "100" });
    let rewrites = 0;
    const rewrite = () => {
      rewrites++;
      return "rewritten";
    };
    const cached = (await readRewritten(key as string, cache)) ?? (() => rewrite())();
    if ((await readRewritten(key as string, cache)) === null) await writeRewritten(key as string, cached, cache);
    const second = (await readRewritten(key as string, cache)) ?? rewrite();
    expect(second).toBe("rewritten");
    expect(rewrites).toBe(1);
  });
});
