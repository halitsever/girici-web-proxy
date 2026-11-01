import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { statusRouter, type StatusReport } from "../src/routes/status.ts";
import { DailyTraffic, startStatsFlush, type StatsFlush } from "../src/stats/daily.ts";
import { TrafficStats, utcDay } from "../src/stats/traffic.ts";

let server: Server;
let flush: StatsFlush;
afterEach(async () => {
  flush.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const limits = { bandwidthPerMinute: 1_048_576, dailyQuota: 0, metrics: true };

async function start() {
  const db = openDb(":memory:");
  const store = new AuthStore(db);
  const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  const stats = new TrafficStats();
  const daily = new DailyTraffic(db);
  flush = startStatsFlush(stats, daily);
  const app = express();
  app.use(statusRouter({ store, stats, daily, flush: flush.flush, limits }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stats,
    cookie: `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`,
  };
}

describe("statusRouter", () => {
  it("gives the signed-in admin the last hour, the last 30 days and the limits", async () => {
    const { base, stats, cookie } = await start();
    expect((await fetch(`${base}/_g/admin/status`)).status).toBe(401);

    stats.answered("http", null);
    const res = await fetch(`${base}/_g/admin/status`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const report = (await res.json()) as StatusReport;
    expect(report.lastHour).toHaveLength(60);
    expect(report.lastHour.at(-1)?.requests).toBe(1);
    expect(report.days.at(-1)).toMatchObject({ day: utcDay(Date.now()), requests: 1 });
    expect(report.limits).toEqual(limits);
    expect(report.openSockets).toBe(0);
    expect(report.startedAt).toBeLessThanOrEqual(Date.now());
  });

  it("refuses a session cookie from another secret", async () => {
    const { base } = await start();
    const forged = `${SESSION_COOKIE}=${createSessionToken(1, "some-other-secret")}`;
    expect((await fetch(`${base}/_g/admin/status`, { headers: { cookie: forged } })).status).toBe(401);
  });

  it("takes the exact path only", async () => {
    const { base, cookie } = await start();
    expect((await fetch(`${base}/_g/admin/Status`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${base}/_g/admin/status/`, { headers: { cookie } })).status).toBe(404);
  });
});
