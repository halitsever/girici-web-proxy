import { afterEach, describe, expect, it, vi } from "vitest";
import { CALLER_LOOKUP_WAIT, lookupClient, SCRIPT_LOOKUP_WAIT } from "../src/sw/client-lookup.ts";

const page = { id: "p", type: "window" };
const slowGet = (after: number) => ({
  get: () => new Promise<typeof page | undefined>((resolve) => setTimeout(() => resolve(page), after)),
});

describe("lookupClient", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for a page a busy browser is slow to find", async () => {
    vi.useFakeTimers();
    const found = lookupClient(slowGet(600), "p", CALLER_LOOKUP_WAIT);
    await vi.advanceTimersByTimeAsync(600);
    expect(await found).toBe(page);
  });

  it("gives up on a script load's client soon", async () => {
    vi.useFakeTimers();
    const found = lookupClient(slowGet(60_000), "w", SCRIPT_LOOKUP_WAIT);
    await vi.advanceTimersByTimeAsync(SCRIPT_LOOKUP_WAIT);
    expect(await found).toBeUndefined();
  });

  it("finds nothing without a client ID", async () => {
    expect(await lookupClient(slowGet(0), "", CALLER_LOOKUP_WAIT)).toBeUndefined();
  });
});
