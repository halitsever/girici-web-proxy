import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { authGate, isAdminCookie, isSessionCookie, sessionAdmin, siteSessionAdmin } from "../src/auth/gate.ts";
import { createSessionToken, createSiteSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function listen(store: AuthStore): Promise<string> {
  const app = express();
  app.use(authGate(store));
  app.get("/probe", (_req, res) => res.status(200).send("ok"));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/probe`;
}

function freshStore(): AuthStore {
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  return store;
}

describe("authGate", () => {
  it("blocks an unauthenticated request with an auth error", async () => {
    const res = await fetch(await listen(freshStore()));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-girici-error")).toBe("auth");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a request with a valid session cookie", async () => {
    const store = freshStore();
    const token = createSessionToken(store.admin()!.id, store.sessionSecret());
    const res = await fetch(await listen(store), { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
  });

  it("blocks a session signed with a rotated secret", async () => {
    const store = freshStore();
    const stale = createSessionToken(store.admin()!.id, store.sessionSecret());
    store.rotateSessionSecret();
    const res = await fetch(await listen(store), { headers: { cookie: `${SESSION_COOKIE}=${stale}` } });
    expect(res.status).toBe(401);
  });

  it("lets a site session through the gate until sessions are revoked", async () => {
    const store = freshStore();
    const cookie = `girici-site=${createSiteSessionToken(store.admin()!.id, store.sessionSecret())}`;
    const url = await listen(store);
    expect((await fetch(url, { headers: { cookie } })).status).toBe(200);
    store.revokeSessions(Date.now() + 1);
    const res = await fetch(url, { headers: { cookie } });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-girici-error")).toBe("auth");
  });

  it("passes any request when public access is on", async () => {
    const store = freshStore();
    store.setPublicAccess(true);
    const res = await fetch(await listen(store));
    expect(res.status).toBe(200);
  });
});

describe("sessionAdmin", () => {
  it("rejects sessions issued before the last revocation", () => {
    const store = freshStore();
    const admin = store.admin()!;
    const now = Date.now();
    const before = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret(), now - 10_000)}`;
    const after = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret(), now)}`;
    store.revokeSessions(now - 5_000);
    expect(sessionAdmin(store, before)).toBeNull();
    expect(isAdminCookie(store, before)).toBe(false);
    expect(sessionAdmin(store, after)?.id).toBe(admin.id);
  });

  it("keeps sessions from before the upgrade, when nothing was ever revoked", () => {
    const store = freshStore();
    const admin = store.admin()!;
    const old = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret(), Date.now() - 86_400_000)}`;
    expect(sessionAdmin(store, old)?.id).toBe(admin.id);
  });

  it("never takes a site session for the admin", () => {
    const store = freshStore();
    const admin = store.admin()!;
    const site = createSiteSessionToken(admin.id, store.sessionSecret());
    expect(sessionAdmin(store, `__Host-girici=${site}`)).toBeNull();
    expect(sessionAdmin(store, `girici-site=${site}`)).toBeNull();
    expect(siteSessionAdmin(store, `girici-site=${site}`)?.id).toBe(admin.id);
    expect(siteSessionAdmin(store, `girici-site=${createSessionToken(admin.id, store.sessionSecret())}`)).toBeNull();
    expect(isSessionCookie(store, `__Secure-girici-site=${site}`)).toBe(true);
    expect(isSessionCookie(store, `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`)).toBe(
      true,
    );
    expect(isSessionCookie(store, "girici-site=junk")).toBe(false);
  });

  it("refuses a site session issued before the last revocation", () => {
    const store = freshStore();
    const admin = store.admin()!;
    const now = Date.now();
    const site = `girici-site=${createSiteSessionToken(admin.id, store.sessionSecret(), now - 10_000)}`;
    store.revokeSessions(now - 5_000);
    expect(siteSessionAdmin(store, site)).toBeNull();
  });
});
