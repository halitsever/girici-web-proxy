import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { uiRouter } from "../src/routes/ui.ts";

let server: Server;
let base: string;
let webDistDir: string;

beforeAll(async () => {
  webDistDir = mkdtempSync(join(tmpdir(), "girici-web-"));
  writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>girici-test</title>");
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  server = createServer(express().use(uiRouter(webDistDir, store, { perMinute: 3 })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(webDistDir, { recursive: true, force: true });
});

describe("uiRouter limits", () => {
  it("caps shell loads per client across app routes with a Retry-After", async () => {
    for (const path of ["/", "/settings", "/"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
    const limited = await fetch(`${base}/account`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
