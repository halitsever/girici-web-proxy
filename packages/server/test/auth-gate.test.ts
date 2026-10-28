import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { authGate } from "../src/auth/gate.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
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

  it("passes any request when public access is on", async () => {
    const store = freshStore();
    store.setPublicAccess(true);
    const res = await fetch(await listen(store));
    expect(res.status).toBe(200);
  });
});
