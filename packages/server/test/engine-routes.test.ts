import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { AuthStore } from "../src/auth/store.ts";
import { BrandStore } from "../src/brand/store.ts";
import { openDb } from "../src/db/open.ts";
import { createHttpServer } from "../src/http/server.ts";
import { createLogger } from "../src/log.ts";
import { createUpstreamAgent } from "../src/upstream/agent.ts";

describe("engine, bootstrap and legacy routes", () => {
  const agent = createUpstreamAgent();
  let engineDir: string;
  let webDir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    engineDir = mkdtempSync(join(tmpdir(), "girici-engine-"));
    webDir = mkdtempSync(join(tmpdir(), "girici-web-"));
    writeFileSync(join(engineDir, "sw.js"), "self.addEventListener('fetch', () => {});");
    writeFileSync(join(engineDir, "boot.js"), "console.log('boot');");
    writeFileSync(join(engineDir, "client.abc123.js"), "console.log('client');");
    const authStore = new AuthStore(openDb(":memory:"));
    server = createHttpServer(
      createApp({
        webDistDir: webDir,
        engineBundlesDir: engineDir,
        sourceUrl: "https://example.com/source",
        logger: createLogger("error", () => {}),
        authStore,
        brand: new BrandStore(join(engineDir, "brand"), authStore),
        relay: { agent, allowedTestHosts: new Set(), maxRequestBody: 1_048_576 },
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await agent.close();
    rmSync(engineDir, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  });

  it("serves the service worker with its scope header", async () => {
    const res = await fetch(`${base}/_g/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("service-worker-allowed")).toBe("/");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect((await fetch(`${base}/_g/boot.js`)).headers.get("cache-control")).toBe("no-cache");
  });

  it("serves hashed client bundles as immutable", async () => {
    const res = await fetch(`${base}/_g/client.abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await fetch(`${base}/_g/sw.js`)).headers.get("cache-control")).toBe("no-cache");
  });

  it("answers direct document hits on proxy paths with the bootstrap page", async () => {
    const res = await fetch(`${base}/~/https/example.com/`, { headers: { "sec-fetch-dest": "document" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<script src="/_g/boot.js" defer></script>');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    expect((await fetch(`${base}/~/https/example.com/a.png`, { headers: { "sec-fetch-dest": "image" } })).status).toBe(
      404,
    );
  });

  it("answers nested document loads with an inert page instead of the bootstrap", async () => {
    for (const dest of ["iframe", "frame", "object", "embed"]) {
      const res = await fetch(`${base}/~/https/example.com/`, {
        headers: { "sec-fetch-dest": dest, accept: "text/html" },
      });
      expect(res.status, dest).toBe(404);
      expect(res.headers.get("content-type"), dest).toMatch(/^text\/plain/);
      expect(res.headers.get("content-security-policy"), dest).toBe("sandbox; default-src 'none'");
      expect(res.headers.get("x-content-type-options"), dest).toBe("nosniff");
      expect(await res.text(), dest).not.toContain("boot.js");
    }
    // Without Sec-Fetch-Dest, a browser that accepts HTML still gets the bootstrap page.
    expect((await fetch(`${base}/~/https/example.com/`, { headers: { accept: "text/html" } })).status).toBe(200);
  });

  it("redirects v1 links to the new scheme", async () => {
    const old = await fetch(`${base}/proxy/https://example.com/a?b=1`, { redirect: "manual" });
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/~/https/example.com/a?b=1");
    expect((await fetch(`${base}/proxy/https:/example.com/`, { redirect: "manual" })).headers.get("location")).toBe(
      "/~/https/example.com/",
    );
    expect((await fetch(`${base}/proxy/not-a-url`, { redirect: "manual" })).status).toBe(404);
  });

  it("refuses service worker scripts other than ours", async () => {
    expect(
      (await fetch(`${base}/~/https/evil.example/sw.js`, { headers: { "service-worker": "script" } })).status,
    ).toBe(403);
    expect((await fetch(`${base}/_g/sw.js`, { headers: { "service-worker": "script" } })).status).toBe(200);
  });
});
