import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.ts";
import { DailyTraffic, KEEP_DAYS, startStatsFlush } from "../src/stats/daily.ts";
import { emptyTotals, TrafficStats, utcDay, type TrafficTotals } from "../src/stats/traffic.ts";

afterEach(() => {
  vi.useRealTimers();
});

const t1: TrafficTotals = { requests: 3, sockets: 1, bytesDown: 500, bytesUp: 20, refused: 2, failed: 1 };
const t2: TrafficTotals = { requests: 5, sockets: 2, bytesDown: 1000, bytesUp: 40, refused: 0, failed: 3 };

describe("DailyTraffic", () => {
  it("sums a day across flushes and lists recent days oldest first", () => {
    const daily = new DailyTraffic(openDb(":memory:"));
    daily.add("2026-11-01", t2);
    daily.add("2026-10-31", t1);
    daily.add("2026-11-01", t2);
    expect(daily.recent(30, "2026-11-01")).toEqual([
      { day: "2026-10-31", ...t1 },
      { day: "2026-11-01", requests: 10, sockets: 4, bytesDown: 2000, bytesUp: 80, refused: 0, failed: 6 },
    ]);
  });

  it("lists only the asked number of days up to today", () => {
    const daily = new DailyTraffic(openDb(":memory:"));
    daily.add("2026-10-02", t1);
    daily.add("2026-10-03", t1);
    daily.add("2026-11-02", t1);
    expect(daily.recent(30, "2026-11-01").map(({ day }) => day)).toEqual(["2026-10-03"]);
  });

  it("forgets days older than the cutoff", () => {
    const daily = new DailyTraffic(openDb(":memory:"));
    daily.add("2026-08-02", t1);
    daily.add("2026-08-03", t1);
    daily.prune("2026-08-03");
    expect(daily.recent(365, "2026-11-01").map(({ day }) => day)).toEqual(["2026-08-03"]);
  });
});

describe("startStatsFlush", () => {
  it("writes the minute's totals every minute and once more when stopped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 1, 12));
    const stats = new TrafficStats();
    const daily = new DailyTraffic(openDb(":memory:"));
    const today = () => daily.recent(1, utcDay(Date.now())).at(-1)?.requests;
    const flush = startStatsFlush(stats, daily, { intervalMs: 60_000 });

    stats.answered("http", null);
    vi.advanceTimersByTime(60_000);
    expect(today()).toBe(1);

    stats.answered("http", null);
    flush.stop();
    expect(today()).toBe(2);

    stats.answered("http", null);
    vi.advanceTimersByTime(5 * 60_000);
    expect(today()).toBe(2);
  });

  it("prunes days older than the kept window when it writes", () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 10, 1, 12);
    vi.setSystemTime(now);
    const daily = new DailyTraffic(openDb(":memory:"));
    const day = (ago: number) => utcDay(now - ago * 86_400_000);
    daily.add(day(KEEP_DAYS + 1), t1);
    daily.add(day(KEEP_DAYS), t1);
    const stats = new TrafficStats();
    stats.answered("http", null);
    startStatsFlush(stats, daily).stop();
    expect(daily.recent(365, day(0)).map(({ day }) => day)).toEqual([day(KEEP_DAYS), day(0)]);
  });

  it("reports a failed write and keeps running", () => {
    vi.useFakeTimers();
    const db = openDb(":memory:");
    const daily = new DailyTraffic(db);
    const stats = new TrafficStats();
    const errors: unknown[] = [];
    const flush = startStatsFlush(stats, daily, { onError: (error) => errors.push(error) });
    db.exec("DROP TABLE traffic_daily");
    stats.answered("http", null);
    vi.advanceTimersByTime(60_000);
    expect(errors).toHaveLength(1);
    stats.answered("http", null);
    expect(() => flush.stop()).not.toThrow();
    expect(errors).toHaveLength(2);
  });
});

describe("emptyTotals", () => {
  it("starts every count at zero", () => {
    expect(emptyTotals()).toEqual({ requests: 0, sockets: 0, bytesDown: 0, bytesUp: 0, refused: 0, failed: 0 });
  });
});
