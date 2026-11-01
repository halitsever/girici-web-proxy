import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPage, openPlan, PLAN_TTL_MS, signPlan } from "../src/sites/clear.ts";
import { readVisited, signVisited } from "../src/sites/cookies.ts";
import { siteHostFor } from "../src/sites/hosts.ts";
import { deriveSiteKeys } from "../src/sites/keys.ts";
import { siteSetup, startSiteApp, type SiteApp } from "./helpers/site-app.ts";

const setup = siteSetup();
const siteA = siteHostFor(new URL("https://site-a.test/"), setup);
const siteB = siteHostFor(new URL("https://site-b.test/"), setup);
const siteC = siteHostFor(new URL("http://site-c.test/"), setup);
const visited = `girici-sites=${signVisited(["https://site-b.test", "https://site-a.test", "http://site-c.test"], setup.keys)}`;

let app: SiteApp;
let send: SiteApp["send"];

beforeEach(async () => {
  app = await startSiteApp(setup);
  ({ send } = app);
});

afterEach(async () => {
  await app.close();
});

const plan = async (sites: string[] | "all", origin = "https://proxy.test") => {
  const res = await send("/_g/sites/plan", {
    host: "proxy.test",
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie: visited },
    body: JSON.stringify({ sites }),
  });
  return { res, start: res.status === 200 ? ((await res.json()) as { start: string }).start : "" };
};

/** Splits a scheme-relative hop into the Host to send and the path. */
const hop = (url: string): [string, string] => {
  const parsed = new URL(`https:${url}`);
  return [parsed.host, `${parsed.pathname}${parsed.search}`];
};

/** Changes the last character of the signature. */
const tamper = (path: string): string =>
  path.replace(/s=([^&]+)/, (_match, mac: string) => `s=${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`);

/** The next hop a clear page refreshes to. */
const refreshOf = (html: string): string => {
  const content = /<meta http-equiv="refresh" content="0;url=([^"]+)"/.exec(html)?.[1] ?? "";
  return content.replaceAll("&amp;", "&");
};

describe("the clearing chain", () => {
  it("plans a chain through every visited site", async () => {
    const { res, start } = await plan("all");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(start).toMatch(/^\/\/[a-z2-7]{26}\.proxy\.test\/_g\/sites\/clear\?p=[^&]+&s=[^&]+&i=0$/);
    expect(hop(start)[0]).toBe(siteB);
  });

  it("plans only listed sites and ignores the rest", async () => {
    const { start } = await plan(["https://site-a.test", "https://unknown.example", "https://site-a.test"]);
    const [host, path] = hop(start);
    expect(host).toBe(siteA);
    const query = new URLSearchParams(path.split("?")[1]);
    expect(openPlan(query.get("p")!, query.get("s")!, setup.keys)).toMatchObject({ sites: ["https://site-a.test"] });
  });

  it("goes straight to the root when nothing is listed", async () => {
    const { start } = await plan(["https://unknown.example"]);
    expect(start).toMatch(/^\/\/proxy\.test\/_g\/sites\/done\?p=[^&]+&s=[^&]+$/);
  });

  it("refuses a plan from another origin or with a malformed body", async () => {
    expect((await plan("all", `https://${siteA}`)).res.status).toBe(403);
    const bad = await send("/_g/sites/plan", {
      host: "proxy.test",
      method: "POST",
      headers: { origin: "https://proxy.test", "content-type": "application/json" },
      body: JSON.stringify({ sites: "some" }),
    });
    expect(bad.status).toBe(400);
    expect((await send("/_g/sites/plan", { host: siteA, method: "POST" })).status).toBe(404);
  });

  it("lands on each host once before it clears there", async () => {
    const { start } = await plan(["https://site-b.test"]);
    const [host, path] = hop(start);
    const landing = await send(path, { host });
    expect(landing.status).toBe(200);
    expect(landing.headers["clear-site-data"]).toBeUndefined();
    expect(landing.headers["cache-control"]).toBe("no-store");
    expect(refreshOf(await landing.text())).toBe(`${path}&b=1`);
    const cleared = await send(`${path}&b=1`, { host });
    expect(cleared.headers["clear-site-data"]).toBe('"cache", "storage"');
    expect(hop(refreshOf(await cleared.text()))[0]).toBe("proxy.test");
  });

  it("clears each host in turn and refuses a tampered or foreign hop", async () => {
    const { start } = await plan(["https://site-b.test", "https://site-a.test"]);
    const [host, landingPath] = hop(start);
    const path = `${landingPath}&b=1`;
    const first = await send(path, { host });
    expect(first.status).toBe(200);
    expect(first.headers["clear-site-data"]).toBe('"cache", "storage"');
    expect(first.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(first.headers["cache-control"]).toBe("no-store");
    const next = refreshOf(await first.text());
    expect(hop(next)[0]).toBe(siteA);
    expect(next).toMatch(/&i=1$/);
    expect((await send(path, { host: siteA })).status).toBe(403);
    expect((await send(tamper(path), { host })).status).toBe(403);
    expect((await send(path.replace("i=0", "i=1"), { host })).status).toBe(403);
    expect((await send(path.replace("i=0", "i=7"), { host })).status).toBe(403);
    expect((await send(path.replace("&i=0", ""), { host })).status).toBe(403);
    const second = await send(`${hop(next)[1]}&b=1`, { host: siteA });
    expect(second.status).toBe(200);
    expect(hop(refreshOf(await second.text()))).toEqual(["proxy.test", expect.stringMatching(/^\/_g\/sites\/done\?/)]);
  });

  it("ends on the root, forgets the cleared sites and returns to Settings", async () => {
    const { start } = await plan(["https://site-b.test", "https://site-a.test"]);
    const query = hop(start)[1].split("?")[1]!.replace(/&i=0$/, "");
    const done = await send(`/_g/sites/done?${query}`, { host: "proxy.test", headers: { cookie: visited } });
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe("/settings?cleared=2");
    const cookie = done.cookies.find((value) => value.startsWith("__Secure-girici-sites="))!;
    expect(cookie).toMatch(/; Domain=proxy\.test; Path=\/_g\/sites;/);
    expect(readVisited(cookie.split(";")[0], setup.keys)).toEqual(["http://site-c.test"]);
    expect((await send(`/_g/sites/done?${tamper(query)}`, { host: "proxy.test" })).status).toBe(403);
    expect((await send(`/_g/sites/done?${query}`, { host: siteC })).status).toBe(404);
  });
});

describe("clear plans", () => {
  it("expire after ten minutes", () => {
    const now = Date.now();
    const signed = new URLSearchParams(
      signPlan({ labels: [], sites: [], https: false, exp: now + PLAN_TTL_MS }, setup.keys),
    );
    const [p, s] = [signed.get("p")!, signed.get("s")!];
    expect(openPlan(p, s, setup.keys, now + PLAN_TTL_MS)).not.toBeNull();
    expect(openPlan(p, s, setup.keys, now + PLAN_TTL_MS + 1_000)).toBeNull();
    expect(openPlan(p, s, deriveSiteKeys("t".repeat(32)), now)).toBeNull();
    expect(openPlan(p, tamper(`s=${s}`).slice(2), setup.keys, now)).toBeNull();
  });

  it("escapes the next hop in the clear page", () => {
    const html = clearPage('//x/"><script>&i=1');
    expect(html).toContain('content="0;url=//x/&quot;&gt;&lt;script&gt;&amp;i=1"');
    expect(html).toContain("Clearing site data…");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});
