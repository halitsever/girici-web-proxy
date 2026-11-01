import { DEFAULT_SITE_PREFS } from "@girici/engine/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSiteSessionToken } from "../src/auth/cookie.ts";
import { readVisited } from "../src/sites/cookies.ts";
import { siteHostFor } from "../src/sites/hosts.ts";
import { siteSetup, startSiteApp, type SiteApp } from "./helpers/site-app.ts";

const setup = siteSetup();
const siteA = siteHostFor(new URL("https://site-a.test/"), setup);
const siteB = siteHostFor(new URL("https://site-b.test/"), setup);
const json = { "content-type": "application/json" };

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

const report = (host: string, site: string, origin = `https://${host}`, cookie?: string) =>
  send("/_g/sites/config", {
    host,
    method: "POST",
    headers: { ...json, origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ site }),
  });

describe("site config", () => {
  it("answers the site config without a key until a private instance's visitor signs in", async () => {
    store.setPublicAccess(false);
    const res = await send("/_g/sites/config", { host: siteA });
    // A worker install fails on anything but 200 or 404, so a signed-out visitor still gets the config.
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.vary).toMatch(/Cookie/i);
    expect(await res.json()).toEqual({
      v: 1,
      domain: "proxy.test",
      label: siteA.split(".")[0],
      key: null,
      prefs: DEFAULT_SITE_PREFS,
      instanceSeal: false,
      // A private instance lets no visitor in, so it never warns.
      deepLinkWarning: false,
    });
    const siteToken = createSiteSessionToken(store.admin()!.id, store.sessionSecret());
    const signedIn = await send("/_g/sites/config", { host: siteA, headers: { cookie: `girici-site=${siteToken}` } });
    expect(((await signedIn.json()) as { key: string }).key).toBe(Buffer.from(setup.keys.label).toString("base64url"));
  });

  it("hands out the key on a public instance and tells the admin's sealing switch", async () => {
    store.setSealAddresses(true);
    const body = (await (await send("/_g/sites/config", { host: siteA })).json()) as {
      key: string;
      instanceSeal: boolean;
    };
    expect(body.key).toBe(Buffer.from(setup.keys.label).toString("base64url"));
    expect(body.instanceSeal).toBe(true);
  });

  it("tells site hosts the shared-link warning switch, which only the root's sign-in state names otherwise", async () => {
    const warning = async () =>
      ((await (await send("/_g/sites/config", { host: siteA })).json()) as { deepLinkWarning: unknown })
        .deepLinkWarning;
    expect(await warning()).toBe(true);
    store.setDeepLinkWarning(false);
    expect(await warning()).toBe(false);
  });

  it("reads the settings the root wrote", async () => {
    const prefs = { blockThirdPartyCookies: false, sealAddresses: true, toolbar: false, engine: "Bing", seen: false };
    const write = await send("/_g/prefs", {
      host: "proxy.test",
      method: "POST",
      body: JSON.stringify(prefs),
      headers: { origin: "https://proxy.test", ...json },
    });
    expect(write.status).toBe(204);
    const cookie = String(write.headers["set-cookie"]);
    expect(cookie).toMatch(/^__Secure-girici-prefs=[^;]+; Max-Age=34560000; Domain=proxy\.test; Path=\/_g\/sites;/);
    const read = await send("/_g/sites/config", { host: siteA, headers: { cookie: cookie.split(";")[0]! } });
    expect(((await read.json()) as { prefs: unknown }).prefs).toEqual(prefs);
  });

  it("takes partial settings and fills the rest with defaults", async () => {
    const write = await send("/_g/prefs", {
      host: "proxy.test",
      method: "POST",
      body: JSON.stringify({ toolbar: false, engine: "Ask" }),
      headers: { origin: "http://proxy.test", ...json },
    });
    const cookie = write.cookies[0]!;
    expect(cookie).toMatch(/^girici-prefs=/);
    expect(cookie).not.toMatch(/Secure/);
    const read = await send("/_g/sites/config", { host: siteB, headers: { cookie: cookie.split(";")[0]! } });
    expect(((await read.json()) as { prefs: unknown }).prefs).toEqual({ ...DEFAULT_SITE_PREFS, toolbar: false });
  });

  it("tells every site host that this browser opened a site from Girici", async () => {
    const write = await send("/_g/prefs", {
      host: "proxy.test",
      method: "POST",
      body: JSON.stringify({ seen: true }),
      headers: { origin: "https://proxy.test", ...json },
    });
    const cookie = write.cookies[0]!.split(";")[0]!;
    for (const host of [siteA, siteB]) {
      const read = await send("/_g/sites/config", { host, headers: { cookie } });
      expect(((await read.json()) as { prefs: unknown }).prefs, host).toEqual({ ...DEFAULT_SITE_PREFS, seen: true });
    }
  });

  it("refuses settings from a site host or another origin", async () => {
    const write = (host: string, origin: string | undefined, body = '{"seen":true}') =>
      send("/_g/prefs", { host, method: "POST", body, headers: { ...(origin ? { origin } : {}), ...json } });
    expect((await write("proxy.test", `https://${siteA}`)).status).toBe(403);
    expect((await write("proxy.test", `http://${siteA}`)).status).toBe(403);
    expect((await write("proxy.test", "https://evil.test")).status).toBe(403);
    expect((await write("proxy.test", "null")).status).toBe(403);
    expect((await write("proxy.test", undefined)).status).toBe(403);
    expect((await write(siteA, `https://${siteA}`)).status).toBe(404);
    expect((await write(siteA, "https://proxy.test")).status).toBe(404);
    expect((await write("proxy.test", "https://proxy.test", "[]")).status).toBe(400);
    expect((await write("proxy.test", "https://proxy.test", '"x"')).status).toBe(400);
    expect((await write("proxy.test", "https://proxy.test", JSON.stringify({ pad: "x".repeat(2048) }))).status).toBe(
      413,
    );
  });

  it("records a visited site only on its own host", async () => {
    const own = await report(siteA, "https://site-a.test");
    expect(own.status).toBe(200);
    const cookie = own.cookies.find((value) => value.startsWith("__Secure-girici-sites="));
    expect(cookie).toMatch(/; Max-Age=34560000; Domain=proxy\.test; Path=\/_g\/sites;/);
    expect(readVisited(cookie!.split(";")[0], setup.keys)).toEqual(["https://site-a.test"]);
    expect(((await own.json()) as { label: string }).label).toBe(siteA.split(".")[0]);
    const foreign = await report(siteB, "https://site-a.test");
    expect(foreign.status).toBe(200);
    expect(foreign.cookies).toEqual([]);
    expect((await report(siteA, "https://site-a.test", "https://evil.test")).status).toBe(403);
  });

  it("adds a site in front of the ones already listed", async () => {
    const first = (await report(siteA, "https://site-a.test")).cookies[0]!.split(";")[0]!;
    const second = await report(siteB, "https://site-b.test", `https://${siteB}`, first);
    expect(readVisited(second.cookies[0]!.split(";")[0], setup.keys)).toEqual([
      "https://site-b.test",
      "https://site-a.test",
    ]);
  });

  it("records nothing for a private instance's signed-out visitor", async () => {
    store.setPublicAccess(false);
    const res = await report(siteA, "https://site-a.test");
    expect(res.cookies).toEqual([]);
    expect(((await res.json()) as { key: unknown }).key).toBeNull();
  });

  it("lists the visited sites on the root only", async () => {
    const cookie = (await report(siteA, "https://site-a.test")).cookies[0]!.split(";")[0]!;
    const list = await send("/_g/sites/list", { host: "proxy.test", headers: { cookie } });
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(await list.json()).toEqual({ sites: [{ site: "https://site-a.test", host: siteA }] });
    expect((await send("/_g/sites/list", { host: siteA, headers: { cookie } })).status).toBe(404);
  });

  it("serves the config on site hosts only", async () => {
    expect((await send("/_g/sites/config", { host: "proxy.test" })).status).toBe(404);
    expect((await send("/_g/sites/config", { host: "127.0.0.1" })).status).toBe(404);
  });
});
