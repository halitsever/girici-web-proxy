import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { BrandStore } from "../src/brand/store.ts";
import { openDb } from "../src/db/open.ts";
import { adminRouter } from "../src/routes/admin.ts";
import { brandRouter } from "../src/routes/brand.ts";
import { HostBlocklist } from "../src/upstream/blocklist.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const password = "pw-123456";

let server: Server;
const dirs: string[] = [];
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const store = new AuthStore(openDb(":memory:"));
  const admin = store.createAdmin({ username: "halit", name: "Halit", email: "h@h.h", password });
  const root = mkdtempSync(join(tmpdir(), "girici-brand-"));
  dirs.push(root);
  const dir = join(root, "brand");
  const brand = new BrandStore(dir, store);
  const app = express();
  app.use(brandRouter(brand));
  app.use(adminRouter(store, new HostBlocklist([], []), brand));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `${SESSION_COOKIE}=${createSessionToken(admin.id, store.sessionSecret())}`;
  return { base, cookie, store, brand, dir };
}

function save(base: string, body: unknown, cookie?: string, origin: string | null = base): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return fetch(`${base}/_g/admin/brand`, { method: "POST", headers, body: JSON.stringify(body) });
}

const logoBody = (bytes: Buffer, type: string) => ({ type, data: bytes.toString("base64") });

describe("brand routes", () => {
  it("shows the default brand to anyone", async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/_g/brand`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: null, logo: null });
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(`${base}/_g/brand/logo`)).status).toBe(404);
  });

  it("saves a name and a logo only with the current password", async () => {
    const { base, cookie } = await setup();
    const change = { name: "Kütüphane", logo: logoBody(PNG, "image/png") };
    expect((await save(base, change, cookie)).status).toBe(403);
    expect((await save(base, { ...change, currentPassword: password })).status).toBe(401);
    expect((await save(base, { ...change, currentPassword: password }, cookie, "http://evil.test")).status).toBe(403);
    const res = await save(base, { ...change, currentPassword: password }, cookie);
    expect(res.status).toBe(200);
    const info = (await res.json()) as { name: string; logo: string };
    expect(info.name).toBe("Kütüphane");
    expect(info.logo).toMatch(/^\/_g\/brand\/logo\?v=[0-9a-f]{16}$/);
    expect(await (await fetch(`${base}/_g/brand`)).json()).toEqual(info);
  });

  it("serves an SVG logo under a sandbox", async () => {
    const { base, cookie } = await setup();
    await save(base, { logo: logoBody(SVG, "image/svg+xml"), currentPassword: password }, cookie);
    const res = await fetch(`${base}/_g/brand/logo`);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).toContain("default-src 'none'");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const etag = `"${createHash("sha256").update(SVG).digest("hex")}"`;
    expect(res.headers.get("etag")).toBe(etag);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(SVG);
    const again = await fetch(`${base}/_g/brand/logo`, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
  });

  it("keeps the old logo when an upload is refused", async () => {
    const { base, cookie } = await setup();
    await save(base, { logo: logoBody(PNG, "image/png"), currentPassword: password }, cookie);
    const res = await save(base, { logo: logoBody(PNG, "image/svg+xml"), currentPassword: password }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ invalid: "logo" });
    expect(Buffer.from(await (await fetch(`${base}/_g/brand/logo`)).arrayBuffer())).toEqual(PNG);
    const bad = await save(base, { name: "x".repeat(41), currentPassword: password }, cookie);
    expect(await bad.json()).toEqual({ invalid: "name" });
  });

  it("clears the logo and the name", async () => {
    const { base, cookie, dir } = await setup();
    await save(base, { name: "A", logo: logoBody(PNG, "image/png"), currentPassword: password }, cookie);
    expect(existsSync(join(dir, "logo"))).toBe(true);
    const res = await save(base, { name: null, logo: null, currentPassword: password }, cookie);
    expect(await res.json()).toEqual({ name: null, logo: null });
    expect(existsSync(join(dir, "logo"))).toBe(false);
  });

  it("keeps the brand across restarts and forgets a logo whose file is gone", async () => {
    const { base, cookie, store, brand, dir } = await setup();
    await save(base, { name: "A", logo: logoBody(PNG, "image/png"), currentPassword: password }, cookie);
    const reopened = new BrandStore(dir, store);
    expect(reopened.info()).toEqual(brand.info());
    expect(reopened.info().logo).not.toBeNull();
    rmSync(join(dir, "logo"));
    expect(new BrandStore(dir, store).info().logo).toBeNull();
  });
});
