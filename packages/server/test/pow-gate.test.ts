import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { powGate, powUpgradeGate } from "../src/pow/gate.ts";
import { issueVisitor, powKey } from "../src/pow/tokens.ts";

let server: Server;
let base: string;
let store: AuthStore;
let adminCookie: string;

beforeAll(async () => {
  store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  adminCookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
  const app = express();
  app.set("trust proxy", 1);
  app.use("/_g/r", powGate({ store }), (_req, res) => {
    res.status(204).end();
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => store.setProofOfWork(true));

function hit(at: string, options: { cookie?: string; xff?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "x-girici-relay": "1" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.xff) headers["x-forwarded-for"] = options.xff;
  return fetch(`${at}/_g/r/https/site-a.test/`, { headers });
}

function visitor(clientKey: string, issued = Date.now()): string {
  return issueVisitor(powKey(store.sessionSecret()), clientKey, issued);
}

describe("powGate", () => {
  it("lets everyone through while the check is off", async () => {
    store.setProofOfWork(false);
    expect((await hit(base)).status).toBe(204);
  });

  it("refuses a visitor without a cookie with the challenge code, and passes the admin without a visitor cookie", async () => {
    const refused = await hit(base);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("x-girici-error")).toBe("challenge");
    expect((await hit(base, { cookie: adminCookie })).status).toBe(204);
  });

  it("checks a visitor again after their address changes", async () => {
    const cookie = `girici-visitor=${visitor("198.51.100.1")}`;
    expect((await hit(base, { cookie, xff: "198.51.100.1" })).status).toBe(204);
    expect((await hit(base, { cookie, xff: "198.51.100.2" })).status).toBe(403);
  });

  it("renews a visitor cookie after an hour under the name it came with", async () => {
    const old = Date.now() - 2 * 3_600_000;
    const plain = await hit(base, { cookie: `girici-visitor=${visitor("127.0.0.1", old)}` });
    expect(plain.status).toBe(204);
    const renewed = plain.headers.get("set-cookie") ?? "";
    expect(renewed).toMatch(/^girici-visitor=[^;]+;/);
    expect(renewed).toContain("Max-Age=86400");
    expect(renewed).toContain("HttpOnly");
    expect(renewed).toContain("SameSite=Lax");
    expect(renewed).not.toContain("Secure");

    const secure = await hit(base, { cookie: `__Host-girici-visitor=${visitor("127.0.0.1", old)}` });
    expect(secure.headers.get("set-cookie")).toMatch(/^__Host-girici-visitor=[^;]+;.*; Secure/);

    const fresh = await hit(base, { cookie: `girici-visitor=${visitor("127.0.0.1", Date.now() - 600_000)}` });
    expect(fresh.status).toBe(204);
    expect(fresh.headers.get("set-cookie")).toBeNull();
  });
});

describe("powUpgradeGate", () => {
  it("refuses a WebSocket upgrade without a cookie", () => {
    const gate = powUpgradeGate({ store });
    const bare = { headers: {} } as IncomingMessage;
    expect(gate(bare, "c")).toEqual({ code: "challenge", status: 403 });
    const carrying = { headers: { cookie: `girici-visitor=${visitor("c")}` } } as IncomingMessage;
    expect(gate(carrying, "c")).toBeNull();
    expect(gate({ headers: { cookie: adminCookie } } as IncomingMessage, "c")).toBeNull();
  });
});
