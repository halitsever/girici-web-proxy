import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter, tokenBucket } from "../src/http/rate-limit.ts";

describe("rateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to max per window, then blocks", () => {
    const allow = rateLimiter({ windowMs: 1000, max: 2 });
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
  });

  it("keys windows per client", () => {
    const allow = rateLimiter({ windowMs: 1000, max: 1 });
    expect(allow("a")).toBe(true);
    expect(allow("b")).toBe(true);
    expect(allow("a")).toBe(false);
  });

  it("resets after the window elapses, pruning the expired window", () => {
    const allow = rateLimiter({ windowMs: 1000, max: 1 });
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(allow("a")).toBe(true);
  });
});

describe("tokenBucket", () => {
  it("allows a burst of perMinute, then refills at perMinute per minute", () => {
    let now = 0;
    const take = tokenBucket({ perMinute: 60, now: () => now });
    for (let i = 0; i < 60; i++) expect(take("a").ok).toBe(true);
    expect(take("a")).toEqual({ ok: false, retryAfter: 1 });
    now += 1000;
    expect(take("a").ok).toBe(true);
    expect(take("a").ok).toBe(false);
  });

  it("keeps clients apart", () => {
    const take = tokenBucket({ perMinute: 1, now: () => 0 });
    expect(take("a").ok).toBe(true);
    expect(take("a").ok).toBe(false);
    expect(take("b").ok).toBe(true);
  });

  it("forgets clients whose bucket has refilled", () => {
    let now = 0;
    const take = tokenBucket({ perMinute: 60, now: () => now });
    for (let i = 0; i < 60; i++) take("a");
    now += 61_000;
    take("b");
    expect(take.size()).toBe(1);
  });
});
