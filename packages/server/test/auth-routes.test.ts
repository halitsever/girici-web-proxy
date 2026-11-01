import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSiteDomain, type SiteDomain } from "@girici/engine/shared";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { authRouter } from "../src/routes/auth.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { hostRequest } from "./helpers/host-request.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

const SETUP_CODE = "TEST-CODE-0001";

async function listen(
  store: AuthStore,
  options: { trustProxy?: boolean; siteDomain?: SiteDomain } = {},
): Promise<string> {
  const app = express();
  if (options.trustProxy) app.set("trust proxy", true);
  app.use(authRouter(store, { loginMax: 5, setupToken: SETUP_CODE, siteDomain: options.siteDomain }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, path: string, body: unknown, origin: string | null = base): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function sessionCookie(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith("__Host-girici=") || c.startsWith("girici-session="));
  return set ? (set.split(";")[0] ?? "") : "";
}

const setup = { username: "halit", name: "Halit", email: "h@h.h", password: "pw-123456" };
const setupWithCode = { ...setup, setupToken: SETUP_CODE };

describe("authRouter state", () => {
  it("reports setup needed when no admin exists", async () => {
    const res = await fetch(`${await listen(new AuthStore(openDb(":memory:")))}/_g/auth/state`);
    expect(await res.json()).toMatchObject({ setup: true, authed: false, public: false });
  });

  it("names the site domain in the sign-in state", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const sites = await listen(store, { siteDomain: parseSiteDomain("proxy.test:8443")! });
    expect(await (await fetch(`${sites}/_g/auth/state`)).json()).toMatchObject({ siteDomain: "proxy.test:8443" });
    server.close();
    const single = await listen(store);
    expect(await (await fetch(`${single}/_g/auth/state`)).json()).toMatchObject({ siteDomain: null });
  });

  it("tells every visitor whether addresses are encrypted", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const base = await listen(store);
    expect(await (await fetch(`${base}/_g/auth/state`)).json()).toMatchObject({ sealAddresses: false });
    store.setSealAddresses(true);
    expect(await (await fetch(`${base}/_g/auth/state`)).json()).toMatchObject({ authed: false, sealAddresses: true });
  });
});

describe("authRouter setup", () => {
  it("rejects a cross-origin setup", async () => {
    const res = await post(await listen(new AuthStore(openDb(":memory:"))), "/_g/setup", setup, "https://evil.test");
    expect(res.status).toBe(403);
  });

  it("creates the admin, sets a session, and refuses a second setup", async () => {
    const base = await listen(new AuthStore(openDb(":memory:")));
    const res = await post(base, "/_g/setup", setupWithCode);
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toMatchObject({ setup: false, authed: true, admin: { name: "Halit" } });
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe("");
    const state = await (await fetch(`${base}/_g/auth/state`, { headers: { cookie } })).json();
    expect(state).toMatchObject({ setup: false, authed: true, admin: { name: "Halit" } });
    expect((await post(base, "/_g/setup", setup)).status).toBe(409);
  });

  it("rejects a weak password", async () => {
    const base = await listen(new AuthStore(openDb(":memory:")));
    expect((await post(base, "/_g/setup", { ...setupWithCode, password: "short" })).status).toBe(400);
  });
});

describe("authRouter login and logout", () => {
  async function withAdmin(): Promise<string> {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin(setup);
    return listen(store);
  }

  it("rejects a wrong password and accepts the right one", async () => {
    const base = await withAdmin();
    expect((await post(base, "/_g/login", { username: "halit", password: "nope" })).status).toBe(401);
    const ok = await post(base, "/_g/login", { username: "halit", password: "pw-123456" });
    expect(ok.status).toBe(200);
    expect(sessionCookie(ok)).not.toBe("");
  });

  it("clears the session on logout", async () => {
    const base = await withAdmin();
    const res = await post(base, "/_g/logout", {});
    expect(res.status).toBe(204);
    const cleared = (name: string) =>
      res.headers.getSetCookie().some((c) => c.startsWith(`${name}=`) && /Expires=|Max-Age=0/.test(c));
    expect(cleared("__Host-girici")).toBe(true);
    expect(cleared("girici-session")).toBe(true);
  });

  it("gives a page served over https the __Host- Secure session cookie", async () => {
    const base = await withAdmin();
    const res = await post(
      base,
      "/_g/login",
      { username: "halit", password: "pw-123456" },
      base.replace("http:", "https:"),
    );
    expect(res.headers.getSetCookie().find((c) => c.startsWith("__Host-girici="))).toMatch(/; Secure/i);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("girici-session="))).toBe(false);
  });

  it("gives a plain-http page a session cookie without Secure, which Safari keeps, and signs in with it", async () => {
    const base = await withAdmin();
    const res = await post(base, "/_g/login", { username: "halit", password: "pw-123456" });
    const set = res.headers.getSetCookie().find((c) => c.startsWith("girici-session="));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).not.toMatch(/Secure/i);
    const cookie = set?.split(";")[0] ?? "";
    const state = (await (await fetch(`${base}/_g/auth/state`, { headers: { cookie } })).json()) as { authed: boolean };
    expect(state.authed).toBe(true);
  });

  it("issues a site session with Domain beside the admin session", async () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin(setup);
    const base = await listen(store, { siteDomain: parseSiteDomain("proxy.test:8443")! });
    const signIn = (origin: string) =>
      hostRequest(base, "/_g/login", {
        host: new URL(origin).host,
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ username: "halit", password: "pw-123456" }),
      });
    const secure = await signIn("https://proxy.test:8443");
    expect(secure.status).toBe(200);
    expect(secure.cookies).toHaveLength(2);
    expect(secure.cookies[0]).toMatch(/^__Host-girici=/);
    expect(secure.cookies[1]).toMatch(
      /^__Secure-girici-site=[^;]+; Max-Age=2592000; Domain=proxy\.test; Path=\/_g\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/,
    );
    const plain = await signIn("http://proxy.test:8443");
    expect(plain.cookies[1]).toMatch(/^girici-site=[^;]+; Max-Age=2592000; Domain=proxy\.test; Path=\/_g\/;/);
    expect(plain.cookies[1]).not.toMatch(/Secure/);
    const single = await post(await listen(store), "/_g/login", { username: "halit", password: "pw-123456" });
    expect(single.headers.getSetCookie()).toHaveLength(1);
  });

  it("issues the site session on setup too", async () => {
    const base = await listen(new AuthStore(openDb(":memory:")), { siteDomain: parseSiteDomain("proxy.test")! });
    const res = await hostRequest(base, "/_g/setup", {
      host: "proxy.test",
      method: "POST",
      headers: { origin: "http://proxy.test", "content-type": "application/json" },
      body: JSON.stringify(setupWithCode),
    });
    expect(res.status).toBe(200);
    expect(res.cookies.some((cookie) => cookie.startsWith("girici-site="))).toBe(true);
  });

  it("clears both sessions on sign-out", async () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin(setup);
    const base = await listen(store, { siteDomain: parseSiteDomain("proxy.test")! });
    const res = await hostRequest(base, "/_g/logout", {
      host: "proxy.test",
      method: "POST",
      headers: { origin: "https://proxy.test", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
    for (const name of ["girici-site", "__Secure-girici-site"]) {
      const cleared = res.cookies.find((cookie) => cookie.startsWith(`${name}=;`));
      expect(cleared, name).toContain("Domain=proxy.test; Path=/_g/");
      expect(cleared, name).toContain("Expires=Thu, 01 Jan 1970");
    }
    expect(res.cookies.some((cookie) => cookie.startsWith("__Host-girici=;"))).toBe(true);
  });

  it("rate-limits repeated login attempts", async () => {
    const base = await withAdmin();
    for (let i = 0; i < 5; i++) await post(base, "/_g/login", { username: "halit", password: "nope" });
    expect((await post(base, "/_g/login", { username: "halit", password: "nope" })).status).toBe(429);
  });
});

describe("authRouter logout everywhere", () => {
  it("signs out every device when asked to log out everywhere", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin(setup);
    const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret(), Date.now() - 1_000)}`;
    const base = await listen(store);
    const res = await fetch(`${base}/_g/logout`, {
      method: "POST",
      headers: { origin: base, cookie, "content-type": "application/json" },
      body: JSON.stringify({ everywhere: true }),
    });
    expect(res.status).toBe(204);
    const state = await fetch(`${base}/_g/auth/state`, { headers: { cookie } });
    expect(await state.json()).toMatchObject({ authed: false });
  });

  it("revokes nothing for an everywhere logout without a session", async () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin(setup);
    const base = await listen(store);
    await post(base, "/_g/logout", { everywhere: true });
    expect(store.sessionsValidAfter()).toBe(0);
  });
});

describe("authRouter limits", () => {
  it("counts sign-ins from one IPv6 /64 together", async () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin(setup);
    const base = await listen(store, { trustProxy: true });
    const attempt = (ip: string) =>
      fetch(`${base}/_g/login`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ username: "halit", password: "wrong-pw-1" }),
      });
    for (let i = 0; i < 5; i++) expect((await attempt(`2001:db8:1:2::${i + 1}`)).status).toBe(401);
    expect((await attempt("2001:db8:1:2::99")).status).toBe(429);
  });
});

describe("authRouter setup code", () => {
  it("refuses setup without the right setup code", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const base = await listen(store);
    expect((await post(base, "/_g/setup", { ...setup, setupToken: "WRONG-CODE-0000" })).status).toBe(403);
    expect(store.hasAdmin()).toBe(false);
  });

  it("keeps setup closed when the router was given no code", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const app = express();
    app.use(authRouter(store));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await post(base, "/_g/setup", { ...setup, setupToken: "" })).status).toBe(403);
  });
});

describe("authRouter exact paths", () => {
  it("routes the auth API only at its exact, case-sensitive paths", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const admin = store.createAdmin(setup);
    const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
    const base = await listen(store);
    const logout = await fetch(`${base}/_g/logout/`, {
      method: "POST",
      headers: { origin: base, cookie, "content-type": "application/json" },
      body: JSON.stringify({ everywhere: true }),
    });
    expect(logout.status).toBe(404);
    expect(store.sessionsValidAfter()).toBe(0);
    expect((await fetch(`${base}/_g/AUTH/state`, { headers: { cookie } })).status).toBe(404);
  });
});
