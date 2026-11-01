import type { DatabaseSync, StatementSync } from "node:sqlite";
import { utcDay, type TrafficStats, type TrafficTotals } from "./traffic.ts";

export const KEEP_DAYS = 90;

const DAY_MS = 86_400_000;

interface DailyRow {
  day: string;
  requests: number;
  sockets: number;
  bytes_down: number;
  bytes_up: number;
  refused: number;
  failed: number;
}

/** Traffic totals per UTC day in the traffic_daily table. */
export class DailyTraffic {
  readonly #add: StatementSync;
  readonly #recent: StatementSync;
  readonly #prune: StatementSync;

  constructor(db: DatabaseSync) {
    this.#add = db.prepare(`
      INSERT INTO traffic_daily (day, requests, sockets, bytes_down, bytes_up, refused, failed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (day) DO UPDATE SET
        requests = requests + excluded.requests,
        sockets = sockets + excluded.sockets,
        bytes_down = bytes_down + excluded.bytes_down,
        bytes_up = bytes_up + excluded.bytes_up,
        refused = refused + excluded.refused,
        failed = failed + excluded.failed`);
    this.#recent = db.prepare("SELECT * FROM traffic_daily WHERE day >= ? AND day <= ? ORDER BY day");
    this.#prune = db.prepare("DELETE FROM traffic_daily WHERE day < ?");
  }

  add(day: string, totals: TrafficTotals): void {
    this.#add.run(
      day,
      totals.requests,
      totals.sockets,
      totals.bytesDown,
      totals.bytesUp,
      totals.refused,
      totals.failed,
    );
  }

  /** The given number of days ending with today, oldest first; days without traffic have no row. */
  recent(days: number, today: string): Array<{ day: string } & TrafficTotals> {
    const first = utcDay(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS);
    return (this.#recent.all(first, today) as unknown as DailyRow[]).map((row) => ({
      day: row.day,
      requests: row.requests,
      sockets: row.sockets,
      bytesDown: row.bytes_down,
      bytesUp: row.bytes_up,
      refused: row.refused,
      failed: row.failed,
    }));
  }

  prune(before: string): void {
    this.#prune.run(before);
  }
}

export interface StatsFlush {
  flush(): void;
  stop(): void;
}

/** Writes the counted traffic once a minute, and only when the minute had any, so an idle server never writes. */
export function startStatsFlush(
  stats: TrafficStats,
  daily: DailyTraffic,
  options: { intervalMs?: number; now?: () => number; onError?: (error: unknown) => void } = {},
): StatsFlush {
  const now = options.now ?? Date.now;
  const flush = () => {
    const days = stats.takeUnflushed();
    if (days.length === 0) return;
    // A failed write loses that minute rather than stopping the server; it is never written twice.
    try {
      for (const { day, totals } of days) daily.add(day, totals);
      daily.prune(utcDay(now() - KEEP_DAYS * DAY_MS));
    } catch (error) {
      options.onError?.(error);
    }
  };
  const timer = setInterval(flush, options.intervalMs ?? 60_000);
  timer.unref();
  return {
    flush,
    stop() {
      clearInterval(timer);
      flush();
    },
  };
}
