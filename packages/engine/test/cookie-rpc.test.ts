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
