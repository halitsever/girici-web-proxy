import { relativeTime } from "./history";

export interface TrafficTotals {
  requests: number;
  sockets: number;
  bytesDown: number;
  bytesUp: number;
  refused: number;
  failed: number;
}

/** What GET /_g/admin/status returns; the server's StatusReport. */
export interface StatusReport {
  startedAt: number;
  openSockets: number;
  lastHour: TrafficTotals[];
  days: Array<{ day: string } & TrafficTotals>;
  limits: { bandwidthPerMinute: number; dailyQuota: number; metrics: boolean };
}

const LOAD_ERROR = "Could not load the status.";

export async function fetchStatus(fetcher: typeof fetch = fetch): Promise<StatusReport> {
  let res: Response;
  try {
    res = await fetcher("/_g/admin/status", { headers: { accept: "application/json" } });
  } catch {
    throw new Error(LOAD_ERROR);
  }
  if (!res.ok) throw new Error(LOAD_ERROR);
  return res.json() as Promise<StatusReport>;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  let rounded = Math.round(value * 10) / 10;
  // 1023.96 KB rounds to 1024 KB, which reads better as 1 MB.
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    rounded = 1;
    unit++;
  }
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${UNITS[unit]}`;
}

export function limitText(bytes: number, per: "minute" | "day"): string {
  return bytes === 0 ? "Off" : `${formatBytes(bytes)} per ${per} per visitor`;
}

export function runningText(startedAt: number, now = Date.now()): string {
  const ago = relativeTime(startedAt, now);
  return ago === "now" ? "Running since just now" : `Running since ${ago} ago`;
}

export function sumTotals(list: readonly TrafficTotals[]): TrafficTotals {
  const sum: TrafficTotals = { requests: 0, sockets: 0, bytesDown: 0, bytesUp: 0, refused: 0, failed: 0 };
  for (const totals of list) {
    for (const key of Object.keys(sum) as Array<keyof TrafficTotals>) sum[key] += totals[key];
  }
  return sum;
}

/** The smallest bar a minute with any traffic gets, in percent, so a quiet minute still shows next to a busy one. */
const MIN_BAR = 3;

export function barHeights(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((value) => (value <= 0 || max === 0 ? 0 : Math.max(MIN_BAR, (value / max) * 100)));
}
