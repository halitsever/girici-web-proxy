import { mkdtempSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { AuthStore } from "../src/auth/store.ts";
import { BrandStore } from "../src/brand/store.ts";
import { openDb } from "../src/db/open.ts";
import { clientKey } from "../src/http/client-ip.ts";
import { createLogger } from "../src/log.ts";
import { openInstanceTools } from "../src/open-instance.ts";
import { createUpstreamAgent } from "../src/upstream/agent.ts";

const TOKEN = "metrics-token-0123456789";
const agent = createUpstreamAgent();
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => agent.close());

function tools(limits: { bandwidthLimit?: number; dailyQuota?: number } = {}) {
  const db = openDb(":memory:");
  const store = new AuthStore(db);
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  const wired = openInstanceTools({
    config: { bandwidthLimit: 0, dailyQuota: 0, metricsToken: TOKEN, powDifficulty: 4, ...limits },
    store,
    db,
    logger: createLogger("error", () => {}),
  });
  cleanups.push(() => wired.statsFlush.stop());
  return { ...wired, store };
}

const visitor = { headers: {} } as IncomingMessage;

describe("openInstanceTools", () => {
  it("wires no bandwidth check while both budgets are off", () => {
    const { app, ws } = tools();
    expect(app.bandwidthGate).toBeUndefined();
    expect(ws.allowFrame).toBeUndefined();
    expect(ws.upgradeGates).toHaveLength(1);
  });

  it("runs the browser check before the bandwidth gate on a WebSocket upgrade", () => {
    const { ws, store } = tools({ bandwidthLimit: 1000 });
    store.setProofOfWork(true);
    ws.observer.bytes("k", 5000, "down");
    expect(ws.upgradeGates.map((gate) => gate(visitor, "k"))).toEqual([
      { code: "challenge", status: 403 },
      { code: "quota", status: 429, retryAfter: expect.any(Number) },
    ]);
  });

  it("feeds one meter from the relay observer to the HTTP gate and the frame check", async () => {
    const { app, ws, store } = tools({ dailyQuota: 1000 });
    const key = clientKey("127.0.0.1");
    expect(ws.allowFrame?.(key)).toBe(true);
    ws.observer.bytes(key, 5000, "down");
    expect(ws.allowFrame?.(key)).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "girici-tools-"));
    const server: Server = createServer(
      createApp({
        webDistDir: dir,
        engineBundlesDir: dir,
        sourceUrl: "https://example.com/source",
        logger: createLogger("error", () => {}),
        authStore: store,
        brand: new BrandStore(join(dir, "brand"), store),
        relay: { agent, allowedTestHosts: new Set(), maxRequestBody: 1_048_576 },
        ...app,
      }),
    );
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/_g/r/https/site-a.test/`, { headers: { "x-girici-relay": "1" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("x-girici-error")).toBe("quota");
    await res.arrayBuffer();
    // The same observer feeds the statistics, so the refusal and the bytes show up in /metrics.
    let metrics = "";
    const deadline = Date.now() + 2000;
    while (!metrics.includes('code="quota"} 1') && Date.now() < deadline) {
      metrics = await (await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } })).text();
    }
    expect(metrics).toContain('girici_relay_requests_total{kind="http",code="quota"} 1');
    expect(metrics).toContain('girici_relay_bytes_total{direction="down"} 5000');
  });
});
