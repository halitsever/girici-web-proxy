import { describe, expect, it } from "vitest";
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

describe("rewrite cache", () => {
  it("keys by version, kind and validators and reuses the rewrite", async () => {
    const cache = new FakeCache();
    const key = cacheKey(new URL("https://s.test/a.js"), "js", { etag: 'W/"1"', lastModified: null, length: "10" });
    expect(key).not.toBeNull();
    expect(await readRewritten(key as string, cache)).toBeNull();
    await writeRewritten(key as string, "rewritten", cache);
    expect(await readRewritten(key as string, cache)).toBe("rewritten");
    const other = cacheKey(new URL("https://s.test/a.js"), "js", { etag: 'W/"2"', lastModified: null, length: "10" });
    expect(await readRewritten(other as string, cache)).toBeNull();
  });

  it("returns no key without a validator", () => {
    expect(cacheKey(new URL("https://s.test/a.js"), "js", { etag: null, lastModified: null, length: null })).toBeNull();
  });
});
