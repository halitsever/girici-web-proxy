import type { RelayErrorCode } from "@girici/engine/shared";
import { describe, expect, it } from "vitest";
import { outcomeClass, TrafficStats, utcDay } from "../src/stats/traffic.ts";

describe("TrafficStats", () => {
  it("adds up answers, bytes and sockets by minute", () => {
    let now = Date.UTC(2026, 10, 1, 12, 0, 30);
    const stats = new TrafficStats({ now: () => now });
    stats.answered("http", null);
    stats.answered("http", "quota");
    stats.answered("http", "dns");
    stats.answered("ws", null);
    stats.bytes("a", 100, "down");
    stats.bytes("b", 7, "up");
    expect(stats.lastHour().at(-1)).toEqual({
      requests: 1,
      sockets: 1,
      bytesDown: 100,
      bytesUp: 7,
      refused: 1,
      failed: 1,
    });
    now += 60_000;
    stats.answered("http", null);
    expect(stats.lastHour()).toHaveLength(60);
    expect(stats.lastHour().at(-2)?.requests).toBe(1);
    now += 61 * 60_000;
    expect(stats.lastHour().every((minute) => minute.requests === 0)).toBe(true);
  });

  it("keeps lifetime counters by kind and code and the open sockets", () => {
    const stats = new TrafficStats();
    stats.answered("ws", null);
    stats.answered("ws", null);
    stats.socketClosed();
    stats.answered("http", "challenge");
    const counters = stats.counters();
    expect(counters.answers.get("ws:ok")).toBe(2);
    expect(counters.answers.get("http:challenge")).toBe(1);
    expect(counters.openSockets).toBe(1);
  });

  it("hands each day's unflushed totals over once", () => {
    let now = Date.UTC(2026, 10, 1, 23, 59, 30);
    const stats = new TrafficStats({ now: () => now });
    stats.answered("http", null);
    now = Date.UTC(2026, 10, 2, 0, 0, 30);
    stats.answered("http", null);
    stats.answered("http", null);
    expect(stats.takeUnflushed().map(({ day, totals }) => [day, totals.requests])).toEqual([
      ["2026-11-01", 1],
      ["2026-11-02", 2],
    ]);
    expect(stats.takeUnflushed()).toEqual([]);
  });

  it("keeps no address it was told about", () => {
    const stats = new TrafficStats();
    stats.bytes("203.0.113.5", 10, "down");
    expect(JSON.stringify({ ...stats.counters(), answers: [...stats.counters().answers] })).not.toContain("203.0.113");
  });
});

describe("outcomeClass", () => {
  it("sorts every code into refused or failed", () => {
    const refused: RelayErrorCode[] = [
      "auth",
      "rate_limited",
      "quota",
      "challenge",
      "blocked",
      "too_large",
      "bad_request",
      "ssrf_blocked",
    ];
    const failed: RelayErrorCode[] = ["dns", "connect", "tls", "timeout", "header_overflow", "proxy"];
    expect(outcomeClass(null)).toBe("ok");
    for (const code of refused) expect(outcomeClass(code)).toBe("refused");
    for (const code of failed) expect(outcomeClass(code)).toBe("failed");
  });
});

describe("utcDay", () => {
  it("names the UTC day, not the local one", () => {
    expect(utcDay(Date.UTC(2026, 10, 1, 23, 59, 59))).toBe("2026-11-01");
    expect(utcDay(Date.UTC(2026, 10, 2, 0, 0, 0))).toBe("2026-11-02");
  });
});
