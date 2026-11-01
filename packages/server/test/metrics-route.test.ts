import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { securityHeaders } from "../src/http/security-headers.ts";
import { metricsRouter, renderMetrics } from "../src/routes/metrics.ts";
import { TrafficStats } from "../src/stats/traffic.ts";

const TOKEN = "metrics-token-0123456789";
const SANDBOX = "sandbox; default-src 'none'; frame-ancestors 'none'";

let server: Server;
let base: string;

beforeEach(async () => {
  const app = express();
  // Mounted after the shared headers, as in createApp, so the route must replace their CSP.
  app.use(securityHeaders());
  app.use(metricsRouter({ token: TOKEN, stats: new TrafficStats() }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("metricsRouter", () => {
  it("serves Prometheus text only with the token", async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer wrong-token-000000" } })).status).toBe(
      401,
    );
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/Metrics`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });

  it("asks for a bearer token and keeps a refusal inert", async () => {
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Basic ${btoa(`x:${TOKEN}`)}` } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("girici_");
  });

  it("takes the exact path only", async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    expect((await fetch(`${base}/metrics/`, { headers })).status).toBe(404);
    expect((await fetch(`${base}/metrics?x=1`, { headers })).status).toBe(200);
  });
});

describe("renderMetrics", () => {
  it("labels requests by kind and code and names no site", () => {
    const stats = new TrafficStats();
    stats.answered("http", null);
    stats.answered("http", "quota");
    stats.bytes("203.0.113.5", 100, "down");
    const text = renderMetrics(stats);
    expect(text).toContain('girici_relay_requests_total{kind="http",code="ok"} 1');
    expect(text).toContain('girici_relay_requests_total{kind="http",code="quota"} 1');
    expect(text).toContain('girici_relay_bytes_total{direction="down"} 100');
    expect(text).toContain("girici_websockets_open 0");
    expect(text).toMatch(/^process_start_time_seconds \d+(\.\d+)?$/m);
    expect(text).not.toContain("203.0.113");
    for (const line of text.split("\n").filter((l) => l && !l.startsWith("#"))) {
      expect(line).toMatch(/^[a-z_]+(\{[a-z_]+="[a-z_]+"(,[a-z_]+="[a-z_]+")*\})? \d+(\.\d+)?$/);
    }
  });

  it("lists every kind and code from the start, so rates work before the first refusal", () => {
    const text = renderMetrics(new TrafficStats());
    expect(text).toContain('girici_relay_requests_total{kind="ws",code="ok"} 0');
    expect(text).toContain('girici_relay_requests_total{kind="http",code="challenge"} 0');
    expect(text).toContain('girici_relay_bytes_total{direction="up"} 0');
  });

  it("declares each metric's type once, before its samples, and ends with a newline", () => {
    const text = renderMetrics(new TrafficStats());
    const types = [...text.matchAll(/^# TYPE (\S+) (\S+)$/gm)].map(([, name, type]) => [name, type]);
    expect(types).toEqual([
      ["girici_relay_requests_total", "counter"],
      ["girici_relay_bytes_total", "counter"],
      ["girici_websockets_open", "gauge"],
      ["process_start_time_seconds", "gauge"],
    ]);
    expect(text.endsWith("\n")).toBe(true);
  });
});
