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
  const nonce = res.cookies.find((value) => value.startsWith("__Secure-girici-clear="))?.split(";")[0] ?? "";
  return { res, nonce, start: res.status === 200 ? ((await res.json()) as { start: string }).start : "" };
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
    const { start, nonce } = await plan(["https://site-b.test"]);
    const [host, path] = hop(start);
    const landing = await send(path, { host, headers: { cookie: nonce } });
    expect(landing.status).toBe(200);
    expect(landing.headers["clear-site-data"]).toBeUndefined();
    expect(landing.headers["cache-control"]).toBe("no-store");
    expect(refreshOf(await landing.text())).toBe(`${path}&b=1`);
    const cleared = await send(`${path}&b=1`, { host, headers: { cookie: nonce } });
    expect(cleared.headers["clear-site-data"]).toBe('"cache", "storage"');
    expect(hop(refreshOf(await cleared.text()))[0]).toBe("proxy.test");
  });

  it("clears each host in turn and refuses a tampered or foreign hop", async () => {
    const { start, nonce } = await plan(["https://site-b.test", "https://site-a.test"]);
    const headers = { cookie: nonce };
    const [host, landingPath] = hop(start);
    const path = `${landingPath}&b=1`;
    const first = await send(path, { host, headers });
    expect(first.status).toBe(200);
    expect(first.headers["clear-site-data"]).toBe('"cache", "storage"');
    expect(first.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(first.headers["cache-control"]).toBe("no-store");
    const next = refreshOf(await first.text());
    expect(hop(next)[0]).toBe(siteA);
    expect(next).toMatch(/&i=1$/);
    expect((await send(path, { host: siteA, headers })).status).toBe(403);
    expect((await send(tamper(path), { host, headers })).status).toBe(403);
    expect((await send(path.replace("i=0", "i=1"), { host, headers })).status).toBe(403);
    expect((await send(path.replace("i=0", "i=7"), { host, headers })).status).toBe(403);
    expect((await send(path.replace("&i=0", ""), { host, headers })).status).toBe(403);
    const second = await send(`${hop(next)[1]}&b=1`, { host: siteA, headers });
    expect(second.status).toBe(200);
    expect(hop(refreshOf(await second.text()))).toEqual(["proxy.test", expect.stringMatching(/^\/_g\/sites\/done\?/)]);
  });

  it("ends on the root, forgets the cleared sites and returns to Settings", async () => {
    const { start, nonce } = await plan(["https://site-b.test", "https://site-a.test"]);
    const query = hop(start)[1].split("?")[1]!.replace(/&i=0$/, "");
    const cookies = `${visited}; ${nonce}`;
    const done = await send(`/_g/sites/done?${query}`, { host: "proxy.test", headers: { cookie: cookies } });
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe("/settings?cleared=2");
    const cookie = done.cookies.find((value) => value.startsWith("__Secure-girici-sites="))!;
    expect(cookie).toMatch(/; Domain=proxy\.test; Path=\/_g\/sites;/);
    expect(readVisited(cookie.split(";")[0], setup.keys)).toEqual(["http://site-c.test"]);
    expect(done.cookies).toContainEqual(
      expect.stringMatching(/^__Secure-girici-clear=; Max-Age=0; Domain=proxy\.test;/),
    );
    const tampered = await send(`/_g/sites/done?${tamper(query)}`, {
      host: "proxy.test",
      headers: { cookie: cookies },
    });
    expect(tampered.status).toBe(403);
    expect((await send(`/_g/sites/done?${query}`, { host: siteC, headers: { cookie: cookies } })).status).toBe(404);
  });
});

describe("binding a plan to its browser", () => {
  it("sets a short-lived nonce cookie that every hop can read", async () => {
    const { res } = await plan("all");
    expect(res.cookies).toContainEqual(
      expect.stringMatching(
        /^__Secure-girici-clear=[\w-]{22}; Max-Age=600; Domain=proxy\.test; Path=\/_g\/sites; HttpOnly; Secure; SameSite=Lax$/,
      ),
    );
  });

  it("refuses every hop and the done page without the asking browser's nonce", async () => {
    const mine = await plan(["https://site-b.test"]);
    const theirs = await plan(["https://site-b.test"]);
    const [host, path] = hop(mine.start);
    const query = path.split("?")[1]!.replace(/&i=0$/, "");
    const done = `/_g/sites/done?${query}`;
    for (const cookie of [undefined, theirs.nonce, "__Secure-girici-clear=junk"]) {
      const headers = cookie ? { cookie } : undefined;
      expect((await send(path, { host, headers })).status).toBe(403);
      expect((await send(`${path}&b=1`, { host, headers })).status).toBe(403);
      expect(
        (await send(done, { host: "proxy.test", headers: { cookie: `${visited}; ${cookie ?? ""}` } })).status,
      ).toBe(403);
    }
    const cleared = await send(`${path}&b=1`, { host, headers: { cookie: `${theirs.nonce}; ${mine.nonce}` } });
    expect(cleared.headers["clear-site-data"]).toBe('"cache", "storage"');
  });
});

describe("clear plans", () => {
  it("expire after ten minutes", () => {
    const now = Date.now();
    const signed = new URLSearchParams(
      signPlan({ labels: [], sites: [], https: false, exp: now + PLAN_TTL_MS, nonce: "n" }, setup.keys),
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

  it("writes the clear page in Turkish", () => {
    const html = clearPage("/next", "tr");
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain("<p>Site verileri temizleniyor…</p>");
  });
});
