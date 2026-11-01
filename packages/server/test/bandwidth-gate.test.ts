import type { IncomingMessage } from "node:http";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  createSiteSessionToken,
  PLAIN_SITE_SESSION_COOKIE,
  SESSION_COOKIE,
} from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { bandwidthGate, bandwidthUpgradeGate, ByteMeter, meterObserver } from "../src/http/bandwidth.ts";
import { createTestCert, relayFetch, startRelay, startUpstream, type TestCert } from "./helpers/upstream.ts";

let cert: TestCert;
const cleanups: Array<() => Promise<void>> = [];
let base: string;
let upstream: Awaited<ReturnType<typeof startUpstream>>;
let meter: ByteMeter;
let adminCookie: string;
let siteSessionCookie: string;
let store: AuthStore;

beforeAll(async () => {
  cert = await createTestCert(["site-a.test"]);
});

beforeEach(async () => {
  store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  adminCookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
  siteSessionCookie = `${PLAIN_SITE_SESSION_COOKIE}=${createSiteSessionToken(admin.id, store.sessionSecret())}`;
  meter = new ByteMeter({ perMinute: 6144, perDay: 0 });
  upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.alloc(4096, 120));
  }, cert);
  const relay = await startRelay({
    testUpstreams: new Map([["site-a.test", { host: "127.0.0.1", port: upstream.port }]]),
    testCa: cert.cert,
    observer: meterObserver(meter),
    before: bandwidthGate({ meter, store }),
  });
  base = relay.base;
  cleanups.push(relay.close, upstream.close);
});

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

describe("bandwidthGate", () => {
  it("lets a response that started under the limit finish and refuses the next one", async () => {
    expect((await (await relayFetch(base, "https/site-a.test/big")).arrayBuffer()).byteLength).toBe(4096);
    expect((await (await relayFetch(base, "https/site-a.test/big")).arrayBuffer()).byteLength).toBe(4096);
    const refused = await relayFetch(base, "https/site-a.test/big");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("x-girici-error")).toBe("quota");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstream.requestCount()).toBe(2);
  });

  it("never refuses or cuts the admin, whatever the address has used", async () => {
    meter.add("127.0.0.1", 1e9);
    const res = await relayFetch(base, "https/site-a.test/big", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4096);
  });

  it("never refuses the admin on a site host, where only the site session arrives", async () => {
    meter.add("127.0.0.1", 1e9);
    const res = await relayFetch(base, "https/site-a.test/big", { headers: { cookie: siteSessionCookie } });
    expect(res.status).toBe(200);
    const gate = bandwidthUpgradeGate({ meter, store });
    expect(gate({ headers: { cookie: siteSessionCookie } } as IncomingMessage, "127.0.0.1")).toBeNull();
  });
});
