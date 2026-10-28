import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { adminRouter } from "../src/routes/admin.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

const setup = { username: "halit", name: "Halit", email: "h@h.h", password: "pw-123456" };

async function withAdmin(): Promise<{ base: string; store: AuthStore; cookie: string }> {
  const store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin(setup);
  const app = express();
  app.use(adminRouter(store));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, store, cookie: `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}` };
}

function post(base: string, path: string, body: unknown, cookie?: string, origin: string | null = base): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("adminRouter account", () => {
  it("rejects an unauthenticated update", async () => {
    const { base } = await withAdmin();
    expect((await post(base, "/_g/account", { name: "X", email: "x@x.x" })).status).toBe(401);
  });

  it("updates the profile for an authed admin", async () => {
    const { base, store, cookie } = await withAdmin();
    const res = await post(base, "/_g/account", { name: "Halit S", email: "new@h.h" }, cookie);
    expect(res.status).toBe(200);
    expect(store.admin()).toMatchObject({ name: "Halit S", email: "new@h.h" });
  });

  it("changes the password, rotating the old session and issuing a new one", async () => {
    const { base, store, cookie } = await withAdmin();
    const res = await post(base, "/_g/account", { name: "Halit", email: "h@h.h", password: "brand-new-pw" }, cookie);
    expect(res.status).toBe(200);
    expect(store.verifyLogin("halit", "brand-new-pw")).not.toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  it("rejects a cross-origin update", async () => {
    const { base, cookie } = await withAdmin();
    expect((await post(base, "/_g/account", { name: "X", email: "x@x.x" }, cookie, "https://evil.test")).status).toBe(403);
  });

  it("does not change the profile when the new password is too short", async () => {
    const { base, store, cookie } = await withAdmin();
    const res = await post(base, "/_g/account", { name: "Changed", email: "c@c.c", password: "short" }, cookie);
    expect(res.status).toBe(400);
    expect(store.admin()).toMatchObject({ name: "Halit", email: "h@h.h" });
  });
});

describe("adminRouter settings", () => {
  it("toggles public access for an authed admin", async () => {
    const { base, store, cookie } = await withAdmin();
    const res = await post(base, "/_g/admin/settings", { publicAccess: true }, cookie);
    expect(res.status).toBe(200);
    expect(store.publicAccess()).toBe(true);
  });
});
