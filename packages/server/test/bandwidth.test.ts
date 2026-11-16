import { describe, expect, it } from "vitest";
import { ByteMeter } from "../src/http/bandwidth.ts";

describe("ByteMeter", () => {
  it("lets a client through until its minute is spent, then names the seconds until it is back", () => {
    let now = 0;
    const meter = new ByteMeter({ perMinute: 60_000, perDay: 0, now: () => now });
    expect(meter.check("a")).toEqual({ ok: true });
    meter.add("a", 90_000);
    expect(meter.check("a")).toEqual({ ok: false, retryAfter: 31, scope: "minute" });
    expect(meter.check("b")).toEqual({ ok: true });
    now += 31_000;
    expect(meter.check("a")).toEqual({ ok: true });
  });

  it("counts a day's bytes until midnight UTC", () => {
    let now = Date.UTC(2026, 10, 1, 23, 59, 0);
    const meter = new ByteMeter({ perMinute: 0, perDay: 1000, now: () => now });
    meter.add("a", 1000);
    expect(meter.check("a")).toEqual({ ok: false, retryAfter: 60, scope: "day" });
    now = Date.UTC(2026, 10, 2, 0, 0, 0);
    expect(meter.check("a")).toEqual({ ok: true });
  });

  it("reports the longer wait when both budgets are spent", () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const meter = new ByteMeter({ perMinute: 60_000, perDay: 1000, now: () => now });
    meter.add("a", 120_000);
    expect(meter.check("a")).toMatchObject({ ok: false, scope: "day", retryAfter: 12 * 3600 });
  });

  it("forgets clients that are idle and full again", () => {
    let now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const meter = new ByteMeter({ perMinute: 60_000, perDay: 0, now: () => now });
    meter.add("a", 10);
    meter.add("b", 10);
    expect(meter.size).toBe(2);
    now += 2 * 60_000;
    meter.check("c");
    expect(meter.size).toBe(0);
  });

  it("lets everything through with both budgets off", () => {
    const meter = new ByteMeter({ perMinute: 0, perDay: 0 });
    meter.add("a", 1e12);
    expect(meter.check("a")).toEqual({ ok: true });
  });

  it("keeps a client's day count until the day ends, and never adds a client by checking it", () => {
    let now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const meter = new ByteMeter({ perMinute: 60_000, perDay: 1_000_000, now: () => now });
    meter.check("a");
    expect(meter.size).toBe(0);
    meter.add("a", 10);
    now += 2 * 60_000;
    meter.check("b");
    expect(meter.size).toBe(1);
    now = Date.UTC(2026, 10, 2, 0, 1, 0);
    meter.check("b");
    expect(meter.size).toBe(0);
  });
});
