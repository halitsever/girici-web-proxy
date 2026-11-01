import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "express";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../src/app.ts";
import { AuthStore } from "../src/auth/store.ts";
import { BrandStore } from "../src/brand/store.ts";
import { openDb } from "../src/db/open.ts";
import type { Limiter } from "../src/http/rate-limit.ts";
import { sendRelayError } from "../src/http/relay-error.ts";
import { NO_OBSERVER, type RelayObserver } from "../src/http/relay-observer.ts";
import { createLogger } from "../src/log.ts";
import { createUpstreamAgent } from "../src/upstream/agent.ts";

const agent = createUpstreamAgent();
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
afterAll(() => agent.close());

/** An app whose pow gate and rate limit record and pass, and whose bandwidth gate records and refuses with quota. */
async function start(options: { publicAccess?: boolean; limitOk?: boolean } & Partial<AppOptions> = {}) {
  const { publicAccess = true, limitOk = true, ...overrides } = options;
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(publicAccess);
  const record: string[] = [];
  const heard: Array<[string, string | null]> = [];
  const observer: RelayObserver = { ...NO_OBSERVER, answered: (kind, code) => heard.push([kind, code]) };
  const limiter: Limiter = Object.assign(
    () => {
      record.push("limit");
      return { ok: limitOk, retryAfter: 1 };
    },
    { size: () => 0 },
  );
  const dir = mkdtempSync(join(tmpdir(), "girici-gates-"));
  const server = createServer(
    createApp({
      webDistDir: dir,
      engineBundlesDir: dir,
      sourceUrl: "https://example.com/source",
      logger: createLogger("error", () => {}),
      authStore: store,
      brand: new BrandStore(join(dir, "brand"), store),
      relay: { agent, allowedTestHosts: new Set(), maxRequestBody: 1_048_576 },
      observer,
      limiter,
      powGate: (_req, _res, next) => {
        record.push("pow");
        next();
      },
      bandwidthGate: (_req, res) => {
        record.push("bandwidth");
        sendRelayError(res, "quota", 429);
      },
      ...overrides,
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, record, heard };
}

/** The observer hears an answer when the response closes, which can trail the client's read by a tick. */
async function heardOnce(heard: unknown[]): Promise<void> {
  const deadline = Date.now() + 2000;
  while (heard.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

const relayGet = (base: string) => fetch(`${base}/_g/r/https/site-a.test/`, { headers: { "x-girici-relay": "1" } });

describe("open-instance gates", () => {
  it("runs the open-instance gates in order and reports each answer", async () => {
    const { base, record, heard } = await start();
    const res = await relayGet(base);
    expect(res.status).toBe(429);
    expect(res.headers.get("x-girici-error")).toBe("quota");
    await heardOnce(heard);
    expect(record).toEqual(["pow", "limit", "bandwidth"]);
    expect(heard).toEqual([["http", "quota"]]);

    for (const path of ["/_g/pot", "/_g/ws-seal"]) {
      record.length = 0;
      await (await fetch(`${base}${path}`, { method: "POST", headers: { origin: base } })).arrayBuffer();
      expect(record, path).toEqual(["pow"]);
    }
    expect(heard).toHaveLength(1);
  });

  it("stops at the rate limit before the bandwidth gate", async () => {
    const { base, record, heard } = await start({ limitOk: false });
    const res = await relayGet(base);
    expect(res.status).toBe(429);
    expect(res.headers.get("x-girici-error")).toBe("rate_limited");
    await heardOnce(heard);
    expect(record).toEqual(["pow", "limit"]);
    expect(heard).toEqual([["http", "rate_limited"]]);
  });

  it("refuses at the auth gate before any other gate on a private instance", async () => {
    const { base, record, heard } = await start({ publicAccess: false });
    const res = await relayGet(base);
    expect(res.status).toBe(401);
    await heardOnce(heard);
    expect(record).toEqual([]);
    expect(heard).toEqual([["http", "auth"]]);
  });

  it("serves the tools' routers ahead of the UI", async () => {
    const tool = (path: string) => Router().get(path, (_req, res) => void res.status(200).send(path));
    const { base } = await start({
      metricsRouter: tool("/metrics"),
      statusRouter: tool("/_g/admin/status"),
      powRouter: tool("/_g/pow"),
    });
    for (const path of ["/metrics", "/_g/admin/status", "/_g/pow"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe(path);
    }
  });
});
