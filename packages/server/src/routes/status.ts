import { Router } from "express";
import { sessionAdmin } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import type { DailyTraffic } from "../stats/daily.ts";
import { utcDay, type TrafficStats, type TrafficTotals } from "../stats/traffic.ts";

export interface StatusReport {
  startedAt: number;
  openSockets: number;
  lastHour: TrafficTotals[];
  days: Array<{ day: string } & TrafficTotals>;
  limits: { bandwidthPerMinute: number; dailyQuota: number; metrics: boolean };
}

/** GET /_g/admin/status: the traffic counts for the signed-in admin. It changes nothing, so a session is enough. */
export function statusRouter(options: {
  store: AuthStore;
  stats: TrafficStats;
  daily: DailyTraffic;
  flush: () => void;
  limits: StatusReport["limits"];
}): Router {
  const { store, stats, daily, flush, limits } = options;
  const router = Router({ caseSensitive: true, strict: true });
  router.get("/_g/admin/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!sessionAdmin(store, req.headers.cookie)) {
      res.status(401).end();
      return;
    }
    // Writes the current minute first, so today's row includes it.
    flush();
    const { startedAt, openSockets } = stats.counters();
    const report: StatusReport = {
      startedAt,
      openSockets,
      lastHour: stats.lastHour(),
      days: daily.recent(30, utcDay(Date.now())),
      limits,
    };
    res.json(report);
  });
  return router;
}
