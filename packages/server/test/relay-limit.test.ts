import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, createSiteSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { compileTrust, type TrustFn } from "../src/http/client-ip.ts";
import { tokenBucket } from "../src/http/rate-limit.ts";
import { relayLimit, warnUntrustedForwarding } from "../src/http/relay-limit.ts";
import { createLogger } from "../src/log.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function limited(perMinute: number | null, trust: TrustFn = compileTrust(false)) {
  const store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  const app = express();
  app.set("trust proxy", trust);
  app.use(
    "/_g/r",
    relayLimit({ limiter: perMinute === null ? null : tokenBucket({ perMinute }), store }),
    (_req, res) => {
      res.status(204).end();
    },
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    store,
    adminCookie: `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`,
    siteCookie: `girici-site=${createSiteSessionToken(admin.id, store.sessionSecret())}`,
  };
}

function hit(base: string, options: { cookie?: string; xff?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "x-girici-relay": "1" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.xff) headers["x-forwarded-for"] = options.xff;
  return fetch(`${base}/_g/r/https/site-a.test/`, { headers });
}

describe("relayLimit", () => {
  it("answers 429 with the relay error headers once a client runs out", async () => {
    const { base } = await limited(2);
    await hit(base);
    await hit(base);
    const res = await hit(base);
    expect(res.status).toBe(429);
    expect(res.headers.get("x-girici-error")).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("never limits the signed-in admin", async () => {
    const { base, adminCookie } = await limited(1);
    await hit(base);
    expect((await hit(base, { cookie: adminCookie })).status).toBe(204);
  });

  it("never limits the admin's site session", async () => {
    const { base, siteCookie } = await limited(1);
    await hit(base);
    expect((await hit(base, { cookie: siteCookie })).status).toBe(204);
  });

  it("does not exempt a session signed with a rotated secret", async () => {
    const { base, adminCookie, store } = await limited(1);
    store.rotateSessionSecret();
    await hit(base);
    expect((await hit(base, { cookie: adminCookie })).status).toBe(429);
  });

  it("keys clients by X-Forwarded-For only when the proxy is trusted", async () => {
    const trusted = await limited(1, compileTrust(1));
    expect((await hit(trusted.base, { xff: "203.0.113.1" })).status).toBe(204);
    expect((await hit(trusted.base, { xff: "203.0.113.2" })).status).toBe(204);
    const untrusted = await limited(1, compileTrust(false));
    expect((await hit(untrusted.base, { xff: "203.0.113.1" })).status).toBe(204);
    expect((await hit(untrusted.base, { xff: "203.0.113.2" })).status).toBe(429);
  });

  it("passes everything when the limit is off", async () => {
    const { base } = await limited(null);
    for (let i = 0; i < 10; i++) expect((await hit(base)).status).toBe(204);
  });
});

describe("warnUntrustedForwarding", () => {
  async function serve(trust: TrustFn, lines: string[]) {
    const app = express();
    app.set("trust proxy", trust);
    app.use(
      "/_g/r",
      warnUntrustedForwarding(
        trust,
        createLogger("warn", (line) => lines.push(line)),
      ),
      (_req, res) => {
        res.status(204).end();
      },
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("warns once when X-Forwarded-For arrives while the proxy is not trusted", async () => {
    const lines: string[] = [];
    const base = await serve(compileTrust(false), lines);
    await hit(base, { xff: "203.0.113.1" });
    await hit(base, { xff: "203.0.113.2" });
    await hit(base);
    expect(lines.filter((line) => line.includes("GIRICI_TRUST_PROXY"))).toHaveLength(1);
  });

  it("stays quiet when the proxy is trusted", async () => {
    const lines: string[] = [];
    const base = await serve(compileTrust(1), lines);
    await hit(base, { xff: "203.0.113.1" });
    expect(lines).toEqual([]);
  });
});
