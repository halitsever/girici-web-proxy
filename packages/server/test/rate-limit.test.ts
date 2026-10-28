import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "../src/http/rate-limit.ts";

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
