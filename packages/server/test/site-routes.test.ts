import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, createSiteSessionToken } from "../src/auth/cookie.ts";
import { FRESH_POST } from "../src/routes/bootstrap.ts";
import { metricsRouter } from "../src/routes/metrics.ts";
import { RETIRE_WORKER, SEALED_GONE } from "../src/routes/sites.ts";
import { siteHostFor } from "../src/sites/hosts.ts";
import { TrafficStats } from "../src/stats/traffic.ts";
import { siteSetup, startSiteApp, type SiteApp } from "./helpers/site-app.ts";

const setup = siteSetup();
const siteA = siteHostFor(new URL("https://site-a.test/"), setup);
const siteB = siteHostFor(new URL("https://site-b.test/"), setup);

let app: SiteApp;
let send: SiteApp["send"];
let store: SiteApp["store"];

beforeEach(async () => {
  app = await startSiteApp(setup);
  ({ send, store } = app);
});

afterEach(async () => {
  await app.close();
});

describe("the root in subdomain mode", () => {
  it("sends a root proxy address to its site's host", async () => {
    const res = await send("/~/https/www.site-a.test/x?y=1", { host: "proxy.test" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`//${siteA}/~/https/www.site-a.test/x?y=1`);
  });

  it("sends a private instance's signed-out visitor to sign in first", async () => {
    store.setPublicAccess(false);
    const res = await send("/~/https/www.site-a.test/x?y=1", { host: "proxy.test" });
    expect(res.headers.location).toBe(`/_g/login?next=${encodeURIComponent("https://www.site-a.test/x?y=1")}`);
  });

  it("asks for the admin session on the root redirect of a private instance", async () => {
    store.setPublicAccess(false);
    const token = createSiteSessionToken(store.admin()!.id, store.sessionSecret());
    for (const cookie of [`girici-site=${token}`, `__Secure-girici-site=${token}`]) {
      const res = await send("/~/https/www.site-a.test/x", { host: "proxy.test", headers: { cookie } });
      expect(res.headers.location, cookie).toMatch(/^\/_g\/login\?next=/);
    }
  });

  it("gives a signed-in admin the site session on the root redirect", async () => {
    store.setPublicAccess(false);
    const admin = `girici-session=${createSessionToken(store.admin()!.id, store.sessionSecret())}`;
    const res = await send("/~/https/www.site-a.test/x", { host: "proxy.test", headers: { cookie: admin } });
    expect(res.headers.location).toBe(`//${siteA}/~/https/www.site-a.test/x`);
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0]).toMatch(/^girici-site=[^;]+; Max-Age=\d+; Domain=proxy\.test; Path=\/_g\/;/);
    const stale = `girici-session=${createSessionToken(store.admin()!.id, store.sessionSecret(), Date.now() - 10_000)}`;
    store.revokeSessions(Date.now() - 5_000);
    const revoked = await send("/~/https/www.site-a.test/x", { host: "proxy.test", headers: { cookie: stale } });
    expect(revoked.headers.location).toMatch(/^\/_g\/login\?next=/);
    expect(revoked.cookies).toEqual([]);
  });

  it("never issues the site session on a site host", async () => {
    const admin = `girici-session=${createSessionToken(store.admin()!.id, store.sessionSecret())}`;
    for (const path of ["/_g/auth/state", "/~/https/site-a.test/", "/_g/sites/config", "/"]) {
      const res = await send(path, { host: siteA, headers: { cookie: admin, "sec-fetch-dest": "document" } });
      expect(res.cookies, path).toEqual([]);
    }
  });

  it("refuses sealed single-origin addresses on the root", async () => {
    const res = await send("/~/x/abc.def", { host: "proxy.test" });
    expect(res.status).toBe(404);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(await res.text()).toBe(SEALED_GONE);
  });

  it("answers an undecodable root proxy address with 400", async () => {
    for (const path of ["/~/https/", "/~/ftp/site-a.test/", "/~/%"]) {
      expect((await send(path, { host: "proxy.test" })).status, path).toBe(400);
    }
  });

  it("retires a root service worker", async () => {
    const res = await send("/_g/sw.js", { host: "proxy.test", headers: { "service-worker": "script" } });
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    // The root worker from single-origin mode controls "/", and an update that cannot keep that scope fails.
    expect(res.headers["service-worker-allowed"]).toBe("/");
    expect(await res.text()).toBe(RETIRE_WORKER);
  });
});

describe("site hosts", () => {
  it("moves a bootstrap load to the right host", async () => {
    const res = await send("/~/https/site-a.test/p", { host: siteB, headers: { "sec-fetch-dest": "document" } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`//${siteA}/~/https/site-a.test/p`);
  });

  it("moves nothing for a private instance's signed-out visitor, whose worker sends them to sign in", async () => {
    store.setPublicAccess(false);
    const document = { "sec-fetch-dest": "document" };
    const res = await send("/~/https/site-a.test/p", { host: siteB, headers: document });
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(await res.text()).toContain("/_g/boot.js");
    const site = `girici-site=${createSiteSessionToken(store.admin()!.id, store.sessionSecret())}`;
    const signedIn = await send("/~/https/site-a.test/p", { host: siteB, headers: { ...document, cookie: site } });
    expect(signedIn.headers.location).toBe(`//${siteA}/~/https/site-a.test/p`);
  });

  it("keeps a form post's method when it moves to the right host", async () => {
    const res = await send("/~/https/site-a.test/acs", {
      host: siteB,
      method: "POST",
      headers: { "sec-fetch-dest": "document", "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(res.status).toBe(307);
    expect(res.headers.location).toBe(`//${siteA}/~/https/site-a.test/acs`);
  });

  it("serves the bootstrap page to frames of a site host", async () => {
    const res = await send("/~/https/site-a.test/p", { host: siteA, headers: { "sec-fetch-dest": "iframe" } });
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' *.proxy.test",
    );
    expect(res.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(await res.text()).toContain('<script src="/_g/boot.js" defer></script>');
  });

  it("serves the bootstrap page for sealed addresses, which only the host's worker can open", async () => {
    const res = await send("/~/x/abc.def", { host: siteA, headers: { "sec-fetch-dest": "document" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("girici-boot");
  });

  it("replays a form posted to a site host without a worker", async () => {
    const res = await send("/~/https/site-a.test/acs", {
      host: siteA,
      method: "POST",
      headers: {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "SAMLResponse=%22%3E%3Cx&RelayState=r",
    });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(
      '<form id="girici-replay" method="post" enctype="application/x-www-form-urlencoded" hidden>',
    );
    expect(html).toContain('name="SAMLResponse" value="&quot;&gt;&lt;x"');
    expect(html).toContain('<script src="/_g/boot.js" defer></script>');
    expect(res.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(res.headers["content-security-policy"]).not.toContain("form-action 'none'");
  });

  it("keeps the order and repeats of replayed fields, plain text forms too", async () => {
    const encoded = await send("/~/https/site-a.test/f", {
      host: siteA,
      method: "POST",
      headers: { "sec-fetch-dest": "document", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "b=2&a=1&b=3",
    });
    const fields = [...(await encoded.text()).matchAll(/name="([^"]*)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(fields).toEqual([
      ["b", "2"],
      ["a", "1"],
      ["b", "3"],
    ]);
    const plain = await send("/~/https/site-a.test/f", {
      host: siteA,
      method: "POST",
      headers: { "sec-fetch-dest": "iframe", "content-type": "text/plain" },
      body: "note=x=y\r\nother=<b>\r\n",
    });
    const html = await plain.text();
    expect(html).toContain('enctype="text/plain"');
    expect(html).toContain('name="note" value="x=y"');
    expect(html).toContain('name="other" value="&lt;b&gt;"');
  });

  it("asks to open the site once before a multipart post", async () => {
    const res = await send("/~/https/site-a.test/upload", {
      host: siteA,
      method: "POST",
      headers: { "sec-fetch-dest": "document", "content-type": "multipart/form-data; boundary=x" },
      body: "--x--\r\n",
    });
    expect(res.status).toBe(404);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(await res.text()).toBe(FRESH_POST);
  });

  it("sends a site host's own root to the UI", async () => {
    const res = await send("/", { host: siteA });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("//proxy.test/");
  });
});

describe("host routing", () => {
  it("answers only the routes of each host kind", async () => {
    const expectations: Array<[string, string, number]> = [
      ["proxy.test", "/_g/auth/state", 200],
      ["proxy.test", "/_g/r/https/site-a.test/", 404],
      ["proxy.test", "/_g/boot.js", 404],
      [siteA, "/_g/auth/state", 404],
      [siteA, "/_g/login", 404],
      [siteA, "/_g/admin/settings", 404],
      [siteA, "/settings", 404],
      [siteA, "/_g/source", 404],
      [siteA, "/_g/brand", 404],
      [siteA, "/proxy/https://site-a.test/", 404],
      [siteA, "/_g/boot.js", 200],
      [siteA, "/", 302],
      ["127.0.0.1", "/healthz", 200],
      ["127.0.0.1", "/robots.txt", 200],
      ["127.0.0.1", "/", 404],
      ["127.0.0.1", "/~/https/site-a.test/", 404],
      ["127.0.0.1", "/_g/boot.js", 404],
      ["www.proxy.test", "/_g/auth/state", 404],
    ];
    for (const [host, path, status] of expectations) {
      expect((await send(path, { host })).status, `${host}${path}`).toBe(status);
    }
  });

  it("serves the engine worker on site hosts only", async () => {
    const site = await send("/_g/sw.js", { host: siteA, headers: { "service-worker": "script" } });
    expect(await site.text()).toBe("void 0;");
    expect((await send("/_g/sw.js", { host: "127.0.0.1" })).status).toBe(404);
  });

  it("marks every host's responses for origin-keyed agent clusters and the root's as same-origin resources", async () => {
    expect((await send("/healthz", { host: siteA })).headers["origin-agent-cluster"]).toBe("?1");
    expect((await send("/healthz", { host: "127.0.0.1" })).headers["origin-agent-cluster"]).toBe("?1");
    expect((await send("/_g/auth/state", { host: "proxy.test" })).headers["cross-origin-resource-policy"]).toBe(
      "same-origin",
    );
    expect((await send("/_g/boot.js", { host: siteA })).headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("routes by the Host header, never a forwarded one", async () => {
    const res = await send("/_g/auth/state", { host: siteA, headers: { "x-forwarded-host": "proxy.test" } });
    expect(res.status).toBe(404);
  });

  it("serves /metrics on the root and on any other host a scraper uses, never on a site host", async () => {
    const token = "metrics-token-0123456789";
    const metrics = await startSiteApp(setup, { metricsRouter: metricsRouter({ token, stats: new TrafficStats() }) });
    try {
      const scrape = (host: string, path = "/metrics", authorization = `Bearer ${token}`) =>
        metrics.send(path, { host, headers: { authorization } });
      for (const host of ["proxy.test", "girici:3000", "127.0.0.1"]) {
        const res = await scrape(host);
        expect(res.status, host).toBe(200);
        expect(await res.text()).toContain("girici_");
        expect((await scrape(host, "/metrics", "Bearer wrong-token-000000")).status, host).toBe(401);
        expect((await scrape(host, "/metrics/")).status, host).toBe(404);
        expect((await scrape(host, "/Metrics")).status, host).toBe(404);
      }
      expect((await scrape(siteA)).status).toBe(404);
    } finally {
      await metrics.close();
    }
  });
});

describe("single-origin mode", () => {
  it("adds no host headers and serves the bootstrap on any host", async () => {
    const single = await startSiteApp(null);
    try {
      const res = await single.send("/~/https/site-a.test/", {
        host: siteA,
        headers: { "sec-fetch-dest": "document" },
      });
      expect(res.status).toBe(200);
      expect(res.headers["origin-agent-cluster"]).toBeUndefined();
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
      const frame = await single.send("/~/https/site-a.test/", {
        host: siteA,
        headers: { "sec-fetch-dest": "iframe" },
      });
      expect(frame.status).toBe(404);
      expect((await single.send("/_g/sites/config", { host: siteA })).status).toBe(404);
    } finally {
      await single.close();
    }
  });
});
