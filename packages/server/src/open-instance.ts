import type { DatabaseSync } from "node:sqlite";
import type { AppOptions } from "./app.ts";
import type { AuthStore } from "./auth/store.ts";
import type { Config } from "./config.ts";
import { bandwidthGate, bandwidthUpgradeGate, ByteMeter, meterObserver } from "./http/bandwidth.ts";
import { observeAll, type RelayObserver } from "./http/relay-observer.ts";
import type { Logger } from "./log.ts";
import { powGate, powUpgradeGate } from "./pow/gate.ts";
import { metricsRouter } from "./routes/metrics.ts";
import { powRouter } from "./routes/pow.ts";
import { statusRouter } from "./routes/status.ts";
import { DailyTraffic, startStatsFlush, type StatsFlush } from "./stats/daily.ts";
import { TrafficStats } from "./stats/traffic.ts";
import type { UpgradeGate, WsRelayOptions } from "./ws/relay-ws.ts";

export interface OpenInstanceTools {
  app: Required<Pick<AppOptions, "observer" | "powGate" | "powRouter" | "statusRouter">> &
    Pick<AppOptions, "bandwidthGate" | "metricsRouter">;
  ws: Required<Pick<WsRelayOptions, "observer" | "upgradeGates">> & Pick<WsRelayOptions, "allowFrame">;
  /** Stopped before the database closes, since the last write goes there. */
  statsFlush: StatsFlush;
}

/** One observer list and one gate order for both relays, so HTTP and WebSockets count and refuse alike. */
export function openInstanceTools({
  config,
  store,
  db,
  logger,
}: {
  config: Pick<Config, "bandwidthLimit" | "dailyQuota" | "metricsToken" | "powDifficulty">;
  store: AuthStore;
  db: DatabaseSync;
  logger: Logger;
}): OpenInstanceTools {
  const observers: RelayObserver[] = [];
  const upgradeGates: UpgradeGate[] = [];

  // The browser check is an admin switch, so it is always wired and reads the switch on each request.
  upgradeGates.push(powUpgradeGate({ store }));

  // Traffic counts for the admin's Status section and, with a token, for /metrics.
  const stats = new TrafficStats();
  observers.push(stats);
  const daily = new DailyTraffic(db);
  const statsFlush = startStatsFlush(stats, daily, {
    onError: (error) =>
      logger.error(`Cannot save traffic statistics: ${error instanceof Error ? error.message : String(error)}`),
  });

  // Bandwidth limit and daily quota: off until one is set. One meter serves both relays, as the rate limit does.
  const meter =
    config.bandwidthLimit > 0 || config.dailyQuota > 0
      ? new ByteMeter({ perMinute: config.bandwidthLimit, perDay: config.dailyQuota })
      : null;
  if (meter) {
    observers.push(meterObserver(meter));
    upgradeGates.push(bandwidthUpgradeGate({ meter, store }));
  }

  const observer = observeAll(observers);
  return {
    app: {
      observer,
      powGate: powGate({ store }),
      powRouter: powRouter({ store, difficulty: config.powDifficulty }),
      bandwidthGate: meter ? bandwidthGate({ meter, store }) : undefined,
      metricsRouter: config.metricsToken ? metricsRouter({ token: config.metricsToken, stats }) : undefined,
      statusRouter: statusRouter({
        store,
        stats,
        daily,
        flush: statsFlush.flush,
        limits: {
          bandwidthPerMinute: config.bandwidthLimit,
          dailyQuota: config.dailyQuota,
          metrics: config.metricsToken !== undefined,
        },
      }),
    },
    ws: { observer, upgradeGates, allowFrame: meter ? (key) => meter.check(key).ok : undefined },
    statsFlush,
  };
}
