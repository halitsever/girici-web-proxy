import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { authRouter } from "../src/routes/auth.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function listen(store: AuthStore): Promise<string> {
  const app = express();
  app.use(authRouter(store, { loginMax: 5 }));
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
  const set = res.headers.getSetCookie().find((c) => c.startsWith("__Host-girici="));
  return set ? (set.split(";")[0] ?? "") : "";
}

const setup = { username: "halit", name: "Halit", email: "h@h.h", password: "pw-123456" };

describe("authRouter state", () => {
  it("reports setup needed when no admin exists", async () => {
    const res = await fetch(`${await listen(new AuthStore(openDb(":memory:")))}/_g/auth/state`);
    expect(await res.json()).toMatchObject({ setup: true, authed: false, public: false });
  });
});

describe("authRouter setup", () => {
  it("rejects a cross-origin setup", async () => {
    const res = await post(await listen(new AuthStore(openDb(":memory:"))), "/_g/setup", setup, "https://evil.test");
    expect(res.status).toBe(403);
  });

  it("creates the admin, sets a session, and refuses a second setup", async () => {
    const base = await listen(new AuthStore(openDb(":memory:")));
    const res = await post(base, "/_g/setup", setup);
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
    expect((await post(base, "/_g/setup", { ...setup, password: "short" })).status).toBe(400);
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
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-girici=") && /Expires=|Max-Age=0/.test(c))).toBe(
      true,
    );
  });

  it("rate-limits repeated login attempts", async () => {
    const base = await withAdmin();
    for (let i = 0; i < 5; i++) await post(base, "/_g/login", { username: "halit", password: "nope" });
    expect((await post(base, "/_g/login", { username: "halit", password: "nope" })).status).toBe(429);
  });
});
