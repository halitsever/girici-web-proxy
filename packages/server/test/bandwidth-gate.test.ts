import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { bandwidthGate, ByteMeter } from "../src/http/bandwidth.ts";
import { createTestCert, relayFetch, startRelay, startUpstream, type TestCert } from "./helpers/upstream.ts";

const KIB = 1024;
const BUDGET = 64 * KIB;
const KEY = "127.0.0.1";

let cert: TestCert;
const cleanups: Array<() => Promise<void>> = [];
let base: string;
let upstream: Awaited<ReturnType<typeof startUpstream>>;
let meter: ByteMeter;
let adminCookie: string;

beforeAll(async () => {
  cert = await createTestCert(["site-a.test"]);
});

beforeEach(async () => {
  const store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  adminCookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
  // A daily budget does not refill while a test runs, so the byte counts below are exact.
  meter = new ByteMeter({ perMinute: 0, perDay: BUDGET });
  upstream = await startUpstream((req, res) => {
    const kib = Number(new URL(req.url ?? "/", "https://x").searchParams.get("kib") ?? 4);
    res.writeHead(200, { "content-type": "application/octet-stream" });
    for (let i = 0; i < kib / 16; i++) res.write(Buffer.alloc(16 * KIB, 120));
    if (kib % 16) res.write(Buffer.alloc((kib % 16) * KIB, 120));
    res.end();
  }, cert);
  const relay = await startRelay({
    testUpstreams: new Map([["site-a.test", { host: "127.0.0.1", port: upstream.port }]]),
    testCa: cert.cert,
    before: bandwidthGate({ meter, store }),
  });
  base = relay.base;
  cleanups.push(relay.close, upstream.close);
});

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

/** Reads what arrives before the body ends or breaks; a refused fetch counts as broken with nothing read. */
async function download(
  kib: number,
  init: RequestInit = {},
): Promise<{ status: number; bytes: number; broken: boolean }> {
  let res: Response;
  try {
    res = await relayFetch(base, `https/site-a.test/file?kib=${kib}`, init);
  } catch {
    return { status: 0, bytes: 0, broken: true };
  }
  const reader = res.body!.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { status: res.status, bytes, broken: false };
      bytes += value.byteLength;
    }
  } catch {
    return { status: res.status, bytes, broken: true };
  }
}

describe("bandwidthGate", () => {
  it("breaks a response that runs over the budget instead of ending it cleanly, then refuses the next", async () => {
    const cut = await download(1024);
    expect(cut.broken).toBe(true);
    expect(cut.bytes).toBeLessThanOrEqual(BUDGET);

    const refused = await relayFetch(base, "https/site-a.test/file");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("x-girici-error")).toBe("quota");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstream.requestCount()).toBe(1);
  });

  it("lets responses that fit the budget finish", async () => {
    expect(await download(32)).toEqual({ status: 200, bytes: 32 * KIB, broken: false });
    expect(await download(16)).toEqual({ status: 200, bytes: 16 * KIB, broken: false });
  });

  it("never relays more than the budget to a new client's parallel requests together", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => download(32)));
    const total = results.reduce((sum, result) => sum + result.bytes, 0);
    expect(total).toBeLessThanOrEqual(BUDGET);
    const whole = results.filter((result) => result.status === 200 && !result.broken);
    expect(whole.length).toBeLessThanOrEqual(2);
  });

  it("never refuses or cuts the admin, whatever the address has used", async () => {
    meter.add(KEY, 1e9);
    expect(await download(1024, { headers: { cookie: adminCookie } })).toEqual({
      status: 200,
      bytes: 1024 * KIB,
      broken: false,
    });
  });

  it("does not count the admin's bytes against their address", async () => {
    await download(1024, { headers: { cookie: adminCookie } });
    expect(meter.size).toBe(0);
    expect(await download(32)).toMatchObject({ status: 200, broken: false });
  });
});
