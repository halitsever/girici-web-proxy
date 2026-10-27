import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { UI_CSP } from "../src/http/security-headers.ts";
import { createLogger } from "../src/log.ts";

async function listen(
  webDistDir: string,
  write: (line: string) => void = () => {},
): Promise<{ server: Server; base: string }> {
  const logger = createLogger("debug", write);
  const server = createServer(createApp({ webDistDir, sourceUrl: "https://example.com/source", logger }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe("createApp", () => {
  let webDistDir: string;
  let emptyDir: string;
  let server: Server;
  let emptyServer: Server;
  let base: string;
  let emptyBase: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    webDistDir = mkdtempSync(join(tmpdir(), "girici-web-"));
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>girici-test</title>");
    mkdirSync(join(webDistDir, "_g/ui"), { recursive: true });
    writeFileSync(join(webDistDir, "_g/ui/app.js"), "console.log(1)");
    emptyDir = mkdtempSync(join(tmpdir(), "girici-empty-"));
    ({ server, base } = await listen(webDistDir, (line) => logLines.push(line)));
    ({ server: emptyServer, base: emptyBase } = await listen(emptyDir));
  });

  afterAll(async () => {
    await Promise.all([close(server), close(emptyServer)]);
    rmSync(webDistDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("serves the health check", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("serves robots.txt that disallows everything", async () => {
    const res = await fetch(`${base}/robots.txt`);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("serves the UI with a strict CSP", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("girici-test");
    expect(res.headers.get("content-security-policy")).toBe(UI_CSP);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves UI assets as immutable", async () => {
    const res = await fetch(`${base}/_g/ui/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=31536000");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("redirects /_g/source to the configured source URL", async () => {
    const res = await fetch(`${base}/_g/source`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/source");
  });

  it("answers proxied paths with 503 until the engine exists", async () => {
    for (const path of ["/~/https/example.com/", "/proxy/https://example.com/"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers malformed percent-encoding in proxy paths with 400 and keeps it out of the error log", async () => {
    for (const path of ["/~/%", "/proxy/%E0%A4%A"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(400);
    }
    expect(logLines.filter((line) => line.includes("ERROR"))).toEqual([]);
  });

  it("sends baseline security headers and hides x-powered-by", async () => {
    for (const path of ["/", "/healthz"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("x-powered-by")).toBeNull();
    }
  });

  it("never sends CORS headers, even for preflight requests", async () => {
    const preflight: RequestInit = {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    };
    const cases: Array<[string, RequestInit]> = [
      ["/", {}],
      ["/healthz", {}],
      ["/", preflight],
      ["/~/https/example.com/", {}],
    ];
    for (const [path, init] of cases) {
      const res = await fetch(`${base}${path}`, init);
      expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    }
  });

  it("returns 503 for / when the UI is not built", async () => {
    expect((await fetch(`${emptyBase}/`)).status).toBe(503);
    expect((await fetch(`${emptyBase}/healthz`)).status).toBe(200);
  });
});
