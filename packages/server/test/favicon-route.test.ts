import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/auth/cookie.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { faviconRouter, iconHref } from "../src/routes/favicon.ts";
import { createUpstreamAgent } from "../src/upstream/agent.ts";
import { HostBlocklist } from "../src/upstream/blocklist.ts";
import { createTestCert, startUpstream, type TestCert } from "./helpers/upstream.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let cert: TestCert;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  cert = await createTestCert(["site-a.test", "cdn.site-a.test"]);
});

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function setup(handler: Handler, options: { open?: boolean; blocked?: string[] } = {}) {
  const upstream = await startUpstream(handler, cert);
  const target = { host: "127.0.0.1", port: upstream.port };
  const testUpstreams = new Map([
    ["site-a.test", target],
    ["cdn.site-a.test", target],
  ]);
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  if (options.open) store.setPublicAccess(true);
  const app = express();
  app.use(
    faviconRouter({
      agent: createUpstreamAgent({ testUpstreams, testCa: cert.cert }),
      store,
      allowedTestHosts: new Set(testUpstreams.keys()),
      blocklist: options.blocked ? new HostBlocklist(options.blocked, []) : undefined,
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())), upstream.close);
  const cookie = `${SESSION_COOKIE}=${createSessionToken(store.admin()!.id, store.sessionSecret())}`;
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    upstream,
    get: (host: string, signedIn = true) =>
      fetch(`${base}/_g/favicon?host=${encodeURIComponent(host)}`, { headers: signedIn ? { cookie } : {} }),
  };
}

const png: Handler = (_req, res) => {
  res.writeHead(200, { "content-type": "image/png" });
  res.end(PNG);
};

describe("favicon route", () => {
  it("serves the site's /favicon.ico to a signed-in admin", async () => {
    const { get } = await setup((req, res) => (req.url === "/favicon.ico" ? png(req, res) : res.writeHead(404).end()));
    const res = await get("site-a.test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it("refuses a visitor who is not signed in unless access is public", async () => {
    const closed = await setup(png);
    expect((await closed.get("site-a.test", false)).status).toBe(401);
    const open = await setup(png, { open: true });
    expect((await open.get("site-a.test", false)).status).toBe(200);
  });

  it("follows a redirect to the icon", async () => {
    const { get } = await setup((req, res) => {
      if (req.url === "/favicon.ico") res.writeHead(301, { location: "https://cdn.site-a.test/icon.png" }).end();
      else png(req, res);
    });
    expect((await get("site-a.test")).status).toBe(200);
  });

  it("falls back to the icon the page names", async () => {
    const { get } = await setup((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<html><head><link rel="icon" href="/static/i.png?v=1&amp;x=2"></head></html>');
      } else if (req.url === "/static/i.png?v=1&x=2") png(req, res);
      else res.writeHead(404).end();
    });
    expect((await get("site-a.test")).status).toBe(200);
  });

  it("refuses anything that is not a raster image", async () => {
    const { get } = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    });
    expect((await get("site-a.test")).status).toBe(404);
  });

  it("refuses bad hosts, blocked sites and addresses outside the test map", async () => {
    const { get } = await setup(png, { blocked: ["site-a.test"] });
    expect((await get("site-a.test")).status).toBe(400);
    expect((await get("127.0.0.1")).status).toBe(400);
    expect((await get("localhost")).status).toBe(400);
    expect((await get("evil.test/../x")).status).toBe(400);
    expect((await get("unmapped.test")).status).toBe(404);
  });

  it("answers repeat requests from its cache", async () => {
    const { get, upstream } = await setup(png);
    await get("site-a.test");
    await get("site-a.test");
    expect(upstream.requestCount()).toBe(1);
  });
});

describe("iconHref", () => {
  it("prefers an apple-touch-icon and skips SVG", () => {
    expect(
      iconHref(
        '<link rel="icon" href="/a.svg"><link rel="shortcut icon" href="/b.ico"><link rel="apple-touch-icon" href="/c.png">',
      ),
    ).toBe("/c.png");
    expect(iconHref('<link href="/b.ico" rel="icon">')).toBe("/b.ico");
    expect(iconHref('<link rel="stylesheet" href="/s.css">')).toBeNull();
  });
});
