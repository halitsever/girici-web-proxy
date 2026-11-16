import { createHash, timingSafeEqual } from "node:crypto";
import { METRICS_PATH } from "@girici/engine/shared";
import { Router, type Response } from "express";
import { RELAY_ERROR_CODES, type TrafficStats } from "../stats/traffic.ts";

const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const KINDS = ["http", "ws"] as const;

/** Prometheus text for the lifetime counters. Labels carry kinds and codes only, never a site or an address. */
export function renderMetrics(stats: TrafficStats): string {
  const { answers, bytesDown, bytesUp, openSockets, startedAt } = stats.counters();
  const lines = [
    "# HELP girici_relay_requests_total Relay answers by kind and code; ok means it reached the site.",
    "# TYPE girici_relay_requests_total counter",
  ];
  for (const kind of KINDS) {
    for (const code of ["ok", ...RELAY_ERROR_CODES]) {
      lines.push(`girici_relay_requests_total{kind="${kind}",code="${code}"} ${answers.get(`${kind}:${code}`) ?? 0}`);
    }
  }
  lines.push(
    "# HELP girici_relay_bytes_total Relayed body and WebSocket bytes, down to browsers and up to sites.",
    "# TYPE girici_relay_bytes_total counter",
    `girici_relay_bytes_total{direction="down"} ${bytesDown}`,
    `girici_relay_bytes_total{direction="up"} ${bytesUp}`,
    "# HELP girici_websockets_open Relayed WebSockets open now.",
    "# TYPE girici_websockets_open gauge",
    `girici_websockets_open ${openSockets}`,
    "# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.",
    "# TYPE process_start_time_seconds gauge",
    `process_start_time_seconds ${startedAt / 1000}`,
  );
  return `${lines.join("\n")}\n`;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Mounted after the shared security headers, so it replaces their CSP with one that keeps the text inert. */
function inert(res: Response): void {
  res.set({
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
}

/** GET /metrics for a scraper holding the token. */
export function metricsRouter(options: { token: string; stats: TrafficStats }): Router {
  const router = Router({ caseSensitive: true, strict: true });
  // Digests have one length, so the comparison takes the same time whatever the guess.
  const expected = digest(options.token);
  router.get(METRICS_PATH, (req, res) => {
    inert(res);
    const given = /^Bearer +(\S+) *$/i.exec(req.get("authorization") ?? "")?.[1];
    if (given === undefined || !timingSafeEqual(digest(given), expected)) {
      res.set("WWW-Authenticate", "Bearer").status(401).type("text/plain").send("unauthorized");
      return;
    }
    // res.send would reorder the content type's parameters.
    res.setHeader("Content-Type", CONTENT_TYPE);
    res.end(renderMetrics(options.stats));
  });
  return router;
}
