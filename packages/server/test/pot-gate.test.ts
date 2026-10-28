import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { createLogger } from "../src/log.ts";
import { createUpstreamAgent } from "../src/upstream/agent.ts";

const agent = createUpstreamAgent();
let server: Server;

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterAll(() => agent.close());

async function listen(store: AuthStore): Promise<string> {
  server = createServer(
    createApp({
      webDistDir: "/nonexistent",
      engineBundlesDir: "/nonexistent",
      sourceUrl: "https://example.com/source",
      logger: createLogger("error", () => {}),
      authStore: store,
      relay: { agent, allowedTestHosts: new Set(), maxRequestBody: 1024 },
      poToken: { mint: async () => "pot:x" },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function privateStore(): AuthStore {
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  return store;
}

function mint(base: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: base };
  if (cookie) headers.cookie = cookie;
  return fetch(`${base}/_g/pot`, { method: "POST", headers, body: JSON.stringify({ contentBinding: "v" }) });
}

describe("poToken gate", () => {
  it("blocks the minter without a session when access is private", async () => {
    const res = await mint(await listen(privateStore()));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-girici-error")).toBe("auth");
  });

  it("mints for an authed admin", async () => {
    const store = privateStore();
    const base = await listen(store);
    const cookie = `${SESSION_COOKIE}=${createSessionToken(store.admin()!.id, store.sessionSecret())}`;
    const res = await mint(base, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ poToken: "pot:x" });
  });

  it("mints without a session when public access is on", async () => {
    const store = privateStore();
    store.setPublicAccess(true);
    expect((await mint(await listen(store))).status).toBe(200);
  });
});
