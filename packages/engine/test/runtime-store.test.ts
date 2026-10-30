import { describe, expect, it } from "vitest";
import { RuntimeStore, sha256Hex, type CacheLike } from "../src/sw/runtime-store.ts";

const path = "/_g/client.T.js";
const good = new TextEncoder().encode("runtime()");

class FakeCache implements CacheLike {
  readonly store = new Map<string, string>();
  async match(request: string): Promise<Response | undefined> {
    const text = this.store.get(request);
    return text === undefined ? undefined : new Response(text);
  }
  async put(request: string, response: Response): Promise<void> {
    this.store.set(request, await response.text());
  }
}

async function storeFor(options: { network: Uint8Array; cached?: string }) {
  const cache = new FakeCache();
  if (options.cached !== undefined) cache.store.set(path, options.cached);
  let count = 0;
  const store = new RuntimeStore([{ path, sha256: await sha256Hex(good.buffer as ArrayBuffer) }], {
    open: async () => cache,
    fetch: async () => {
      count++;
      return new Response(options.network);
    },
    digest: sha256Hex,
  });
  return { store, cache: { match: (key: string) => cache.match(key) }, fetches: () => count };
}

describe("RuntimeStore", () => {
  it("serves verified bytes from memory after install", async () => {
    const { store, fetches } = await storeFor({ network: good });
    await store.install();
    expect(new Uint8Array((await store.bytes(path))!)).toEqual(good);
    expect(fetches()).toBe(1);
  });

  it("ignores a tampered cache entry, refetches and repairs the cache", async () => {
    const { store, cache } = await storeFor({ network: good, cached: "evil()" });
    expect(new TextDecoder().decode((await store.bytes(path))!)).toBe("runtime()");
    expect(await (await cache.match(path))!.text()).toBe("runtime()");
  });

  it("fails closed when the network copy does not match either", async () => {
    const { store } = await storeFor({ network: new TextEncoder().encode("minified()"), cached: "evil()" });
    expect(await store.bytes(path)).toBeNull();
    expect((await store.response(path)).type).toBe("error");
  });

  it("installs what it can verify and caches nothing else", async () => {
    const { store, cache } = await storeFor({ network: new TextEncoder().encode("minified()") });
    await store.install();
    expect(await cache.match(path)).toBeUndefined();
  });

  it("answers a verified response with the script type", async () => {
    const { store } = await storeFor({ network: good });
    await store.install();
    const res = await store.response(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("runtime()");
  });

  it("only knows the paths it was built with", async () => {
    const { store } = await storeFor({ network: good });
    expect(store.has(path)).toBe(true);
    expect(store.has("/_g/other.js")).toBe(false);
  });
});
