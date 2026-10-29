import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { adminRouter } from "../src/routes/admin.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { HostBlocklist } from "../src/upstream/blocklist.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

const setup = { username: "halit", name: "Halit", email: "h@h.h", password: "pw-123456" };

async function withAdmin(
  options: { envBlocked?: string[] } = {},
): Promise<{ base: string; store: AuthStore; cookie: string; blocklist: HostBlocklist }> {
  const store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin(setup);
  const blocklist = new HostBlocklist(options.envBlocked ?? [], store.blockedHosts());
  const app = express();
  app.use(adminRouter(store, blocklist));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    store,
    blocklist,
    cookie: `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`,
  };
}

function post(
  base: string,
  path: string,
  body: unknown,
  cookie?: string,
  origin: string | null = base,
): Promise<Response> {
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
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`) || c.startsWith("girici-session=")),
    ).toBe(true);
  });

  it("rejects a cross-origin update", async () => {
    const { base, cookie } = await withAdmin();
    expect((await post(base, "/_g/account", { name: "X", email: "x@x.x" }, cookie, "https://evil.test")).status).toBe(
      403,
    );
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

  it("returns the settings with the stored and env blocklists", async () => {
    const { base, cookie } = await withAdmin({ envBlocked: ["env.example"] });
    const res = await fetch(`${base}/_g/admin/settings`, { headers: { cookie } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ public: false, blockedHosts: [], envBlockedHosts: ["env.example"] });
  });

  it("refuses the settings to anyone but the admin", async () => {
    const { base } = await withAdmin();
    expect((await fetch(`${base}/_g/admin/settings`)).status).toBe(401);
  });

  it("saves a normalized blocklist and applies it at once", async () => {
    const { base, cookie, store, blocklist } = await withAdmin();
    const res = await post(
      base,
      "/_g/admin/settings",
      { blockedHosts: ["https://Bad.example/x", "*.worse.example"] },
      cookie,
    );
    expect((await res.json()).blockedHosts).toEqual(["bad.example", "worse.example"]);
    expect(store.blockedHosts()).toEqual(["bad.example", "worse.example"]);
    expect(blocklist.isBlocked("www.worse.example")).toBe(true);
  });

  it("rejects the whole list when one entry is invalid", async () => {
    const { base, cookie, store, blocklist } = await withAdmin();
    await post(base, "/_g/admin/settings", { blockedHosts: ["keep.example"] }, cookie);
    const res = await post(base, "/_g/admin/settings", { blockedHosts: ["ok.example", "not a host"] }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ invalid: ["not a host"] });
    expect(store.blockedHosts()).toEqual(["keep.example"]);
    expect(blocklist.isBlocked("ok.example")).toBe(false);
  });

  it("rejects more than 1000 entries", async () => {
    const { base, cookie } = await withAdmin();
    const hosts = Array.from({ length: 1001 }, (_, i) => `h${i}.example`);
    expect((await post(base, "/_g/admin/settings", { blockedHosts: hosts }, cookie)).status).toBe(400);
  });

  it("rejects a cross-origin blocklist change", async () => {
    const { base, cookie } = await withAdmin();
    expect((await post(base, "/_g/admin/settings", { blockedHosts: [] }, cookie, "https://evil.example")).status).toBe(
      403,
    );
  });
});
