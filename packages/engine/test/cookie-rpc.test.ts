import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { CookieService } from "../src/sw/cookies/jar.ts";
import { CookieRpc } from "../src/sw/rpc.ts";

async function service() {
  const records = new Map<string, unknown>();
  const jar = new CookieService(
    {
      loadAll: async () => [...records].map(([key, value]) => ({ key, value })),
      write: async (puts, deletes) => {
        for (const { key, value } of puts) records.set(key, value);
        for (const key of deletes) records.delete(key);
      },
    },
    { flushDelay: 0 },
  );
  await jar.ready();
  return jar;
}

const page = new URL("https://site-a.test/page");
const post = (body: unknown) =>
  new Request("http://proxy.test/_g/rpc/cookie", { method: "POST", body: JSON.stringify(body) });

describe("CookieRpc", () => {
  it("stores script cookies for the calling page and answers with its cookies", async () => {
    const cookies = await service();
    const res = await new CookieRpc(cookies).handle(
      post({ v: PROTOCOL_VERSION, seq: 1, cookie: "a=1; path=/" }),
      "client-1",
      page,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cookies: Array<{ name: string }> }).cookies.map((c) => c.name)).toEqual(["a"]);
    expect(
      await cookies.header(page, { initiator: page, credentials: "include", topLevel: false, method: "GET" }),
    ).toBe("a=1");
  });

  it("asks a runtime from 2.1.2 to reload", async () => {
    const rpc = new CookieRpc(await service());
    const res = await rpc.handle(post({ v: 1, seq: 1, cookie: "a=1" }), "c1", page);
    expect(res.status).toBe(409);
  });

  it("refuses other protocol versions, malformed bodies and unknown pages", async () => {
    const rpc = new CookieRpc(await service());
    expect((await rpc.handle(post({ v: PROTOCOL_VERSION + 1, seq: 1, cookie: "a=1" }), "c", page)).status).toBe(409);
    expect((await rpc.handle(post({ v: PROTOCOL_VERSION, cookie: 5 }), "c", page)).status).toBe(400);
    expect((await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 1, cookie: "a=1" }), "c", null)).status).toBe(400);
  });

  it("lets requests wait for the cookie writes their page made first", async () => {
    const rpc = new CookieRpc(await service(), { maxWait: 1000 });
    let waited = false;
    const waiting = rpc.waitFor("client-1", 2).then(() => {
      waited = true;
    });
    await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 1, cookie: "a=1" }), "client-1", page);
    await Promise.resolve();
    expect(waited).toBe(false);
    await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 2, cookie: "b=1" }), "client-1", page);
    await waiting;
    expect(waited).toBe(true);
  });

  it("stops waiting after the time limit", async () => {
    const rpc = new CookieRpc(await service(), { maxWait: 20 });
    const started = Date.now();
    await rpc.waitFor("client-1", 5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("applies a batch in order", async () => {
    const cookies = await service();
    const rpc = new CookieRpc(cookies, { maxWait: 1000 });
    const waiting = rpc.waitFor("client-1", 2);
    const res = await rpc.handle(
      post({ v: PROTOCOL_VERSION, seq: 2, cookies: ["a=1; path=/", "a=2; path=/"] }),
      "client-1",
      page,
    );
    expect(res.status).toBe(200);
    await waiting;
    expect(
      await cookies.header(page, { initiator: page, credentials: "include", topLevel: false, method: "GET" }),
    ).toBe("a=2");
    expect(((await res.json()) as { cookies: Array<{ value: string }> }).cookies.map((c) => c.value)).toEqual(["2"]);
  });

  it("applies a page's batches in order when a later one arrives first", async () => {
    const cookies = await service();
    const rpc = new CookieRpc(cookies, { maxWait: 1000 });
    const header = () =>
      cookies.header(page, { initiator: page, credentials: "include", topLevel: false, method: "GET" });
    await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 1, cookies: ["a=1"] }), "c1", page);
    const later = rpc.handle(post({ v: PROTOCOL_VERSION, seq: 3, cookies: ["a=3"] }), "c1", page);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await header()).toBe("a=1");
    await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 2, cookies: ["a=2", "b=2"] }), "c1", page);
    await later;
    expect(await header()).toBe("a=3; b=2");
    // A batch that turns up after the writes that followed it never puts an older value back.
    await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 2, cookies: ["a=old", "b=old"] }), "c1", page);
    expect(await header()).toBe("a=3; b=2");
  });

  it("applies one batch of a page at a time, even when two arrive together", async () => {
    const cookies = await service();
    const applied: string[] = [];
    const slow = {
      setFromScript: async (url: URL, text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        applied.push(text);
        return cookies.setFromScript(url, text);
      },
      snapshot: (url: URL) => cookies.snapshot(url),
    } as unknown as CookieService;
    const rpc = new CookieRpc(slow);
    await Promise.all([
      rpc.handle(post({ v: PROTOCOL_VERSION, seq: 2, cookies: ["a=1", "a=2"] }), "c1", page),
      rpc.handle(post({ v: PROTOCOL_VERSION, seq: 3, cookies: ["a=3"] }), "c1", page),
    ]);
    expect(applied).toEqual(["a=1", "a=2", "a=3"]);
  });

  it("still takes a single cookie", async () => {
    const cookies = await service();
    const res = await new CookieRpc(cookies).handle(post({ v: PROTOCOL_VERSION, seq: 1, cookie: "a=1" }), "c", page);
    expect(res.status).toBe(200);
    expect(
      await cookies.header(page, { initiator: page, credentials: "include", topLevel: false, method: "GET" }),
    ).toBe("a=1");
  });

  it("refuses a batch that is empty, too long or not all strings", async () => {
    const cookies = await service();
    const rpc = new CookieRpc(cookies);
    const status = async (body: Record<string, unknown>) =>
      (await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 1, ...body }), "c", page)).status;
    expect(await status({ cookies: [] })).toBe(400);
    expect(await status({ cookies: Array.from({ length: 51 }, (_, i) => `n${i}=1`) })).toBe(400);
    expect(await status({ cookies: ["a=1", 5] })).toBe(400);
    expect(await status({ cookies: "a=1" })).toBe(400);
    expect(await status({ cookies: ["a=1"], cookie: "b=1" })).toBe(400);
    expect(await cookies.snapshot(page)).toEqual([]);
    expect(await status({ cookies: Array.from({ length: 50 }, (_, i) => `n${i}=1`) })).toBe(200);
  });

  it("ignores a blocked script write but still releases requests waiting on it", async () => {
    const cookies = await service();
    const rpc = new CookieRpc(cookies);
    const tracker = new URL("https://tracker.test/");
    const res = await rpc.handle(post({ v: PROTOCOL_VERSION, seq: 1, cookie: "t=1" }), "c1", tracker, {
      blocked: true,
    });
    expect(await res.json()).toEqual({ cookies: [] });
    expect(await cookies.snapshot(tracker)).toEqual([]);
    expect(rpc.clientIds()).toContain("c1");
  });
});
