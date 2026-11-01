import { describe, expect, it } from "vitest";
import { barHeights, fetchStatus, formatBytes, limitText, runningText, sumTotals, type StatusReport } from "../status";

const zero = { requests: 0, sockets: 0, bytesDown: 0, bytesUp: 0, refused: 0, failed: 0 };

describe("formatBytes", () => {
  it("uses powers of 1024 with one decimal only when needed", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatBytes(52_428_800)).toBe("50 MB");
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2 TB");
  });

  it("moves up a unit when rounding reaches 1024", () => {
    expect(formatBytes(1_048_575)).toBe("1 MB");
  });
});

describe("limitText", () => {
  it("names the size per period per visitor, or Off", () => {
    expect(limitText(0, "day")).toBe("Off");
    expect(limitText(1_048_576, "minute")).toBe("1 MB per minute per visitor");
    expect(limitText(2 * 1024 ** 3, "day")).toBe("2 GB per day per visitor");
  });
});

describe("runningText", () => {
  it("says how long ago the server started", () => {
    const now = Date.UTC(2026, 10, 1, 12);
    expect(runningText(now - 10_000, now)).toBe("Running since just now");
    expect(runningText(now - 5 * 60_000, now)).toBe("Running since 5m ago");
    expect(runningText(now - 3 * 86_400_000, now)).toBe("Running since 3d ago");
  });
});

describe("sumTotals", () => {
  it("adds up every count", () => {
    expect(sumTotals([])).toEqual(zero);
    expect(
      sumTotals([
        { ...zero, requests: 2, bytesDown: 10, refused: 1 },
        { ...zero, requests: 3, bytesUp: 4, failed: 2 },
      ]),
    ).toEqual({ ...zero, requests: 5, bytesDown: 10, bytesUp: 4, refused: 1, failed: 2 });
  });
});

describe("barHeights", () => {
  it("scales each value against the largest, as a percentage", () => {
    expect(barHeights([0, 50, 100])).toEqual([0, 50, 100]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });

  it("keeps a minute with any traffic visible", () => {
    expect(barHeights([1, 1_000_000])[0]).toBeGreaterThan(0);
  });
});

describe("fetchStatus", () => {
  const report: StatusReport = {
    startedAt: 1,
    openSockets: 2,
    lastHour: [zero],
    days: [{ day: "2026-11-01", ...zero }],
    limits: { bandwidthPerMinute: 0, dailyQuota: 0, metrics: false },
  };

  it("reads the admin status", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    expect(await fetchStatus(fetcher)).toEqual(report);
    expect(urls).toEqual(["/_g/admin/status"]);
  });

  it("fails with one message whatever went wrong", async () => {
    const unauthorized = (async () => new Response(null, { status: 401 })) as typeof fetch;
    await expect(fetchStatus(unauthorized)).rejects.toThrow("Could not load the status.");
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchStatus(offline)).rejects.toThrow("Could not load the status.");
  });
});
