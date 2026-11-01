import { request } from "node:http";
import { expect, openThroughUi, siteHost, SITES, test } from "./support/test.ts";

const SITE_A = siteHost("https://site-a.test/");
const SITE_B = siteHost("https://site-b.test/");

/** A GET straight to the site-mode server with the given Host, which no browser would send for an unknown host. */
function statusFor(host: string, path: string): Promise<number> {
  const { port } = new URL(SITES);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

test("each site opens on its own host and a site's origins share it", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  expect(new URL(page.url()).origin).toBe(SITE_A);
  // The bootstrap page shares its address with the page it loads, so the heading shows the load is over.
  await page.goto("/~/https/www.site-a.test/landing");
  await page.waitForURL(`${SITE_A}/~/https/www.site-a.test/landing`);
  await expect(page.locator("h1")).toHaveText("Landing");
  await page.goto("/~/https/site-b.test/");
  await page.waitForURL(`${SITE_B}/~/https/site-b.test/`);
  await expect(page.locator("h1")).toHaveText("Site B");
});

test("another site's frame is out of reach by index, name and computed location", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/frames");
  await expect(page.frameLocator("#b").locator("h1")).toHaveText("Child");
  await expect(page.frameLocator("#www").locator("h1")).toHaveText("Child");
  await page.click("#probe");
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    framesDocument: "SecurityError",
    windowIndex: "SecurityError",
    named: "SecurityError",
    computedLocation: "SecurityError",
    sameSite: "read",
  });
});

test("keeps OPFS per site", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "WebKit has no OPFS in Playwright's ephemeral profile");
  await page.goto("/~/https/site-a.test/sites/opfs?write=1");
  await expect(page.locator("#opfs")).toHaveText("written");
  await page.goto("/~/https/site-b.test/sites/opfs");
  await expect(page.locator("#opfs")).toHaveText("missing");
  await page.goto("/~/https/site-a.test/sites/opfs");
  await expect(page.locator("#opfs")).toHaveText("present");
});

test("keeps a site's blob URLs to itself", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/blob");
  await expect(page.locator("#blob")).toHaveText("blocked");
});

test("an OAuth-style popup and its opener talk with real origins", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/oauth");
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  const opened = await popup;
  await expect(page.locator("#opener")).toHaveText("https://site-b.test t");
  await expect(opened.locator("#popup")).toHaveText("ack from https://site-a.test");
  expect(new URL(opened.url()).origin).toBe(SITE_B);
});

test("a popup on a name under its site talks with its real origin", async ({ page }) => {
  // www.site-a.test shares site-a's host, so the opener waits for its worker to confirm that before delivering.
  const popupUrl = "https://www.site-a.test/sites/oauth-popup?opener=https://site-b.test";
  await page.goto(`/~/https/site-b.test/sites/oauth?popup=${encodeURIComponent(popupUrl)}`);
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  const opened = await popup;
  await expect(page.locator("#opener")).toHaveText("https://www.site-a.test t");
  await expect(opened.locator("#popup")).toHaveText("ack from https://site-b.test");
  expect(new URL(opened.url()).origin).toBe(SITE_A);
});

test("a form built by script posts to another site with its fields", async ({ page }) => {
  await page.goto("/~/https/site-b.test/");
  await expect(page.locator("h1")).toHaveText("Site B");
  await page.goto("/~/https/site-a.test/sites/post");
  await page.click("#send");
  await page.waitForURL(`${SITE_B}/~/https/site-b.test/sites/echo`);
  await expect(page.locator("#echo")).toHaveText("POST q=posted&n=%C3%BC&submit=1");
});

test("a form built by script posts its fields to a site whose host has no worker yet", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/post");
  await page.click("#send");
  await page.waitForURL(`${SITE_B}/~/https/site-b.test/sites/echo`);
  await expect(page.locator("#echo")).toHaveText("POST q=posted&n=%C3%BC&submit=1");
});

test("a frame of a site never opened before loads on its own host", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/embed-c");
  await expect(page.frameLocator("#c").locator("h1")).toHaveText("Site C");
  const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
  expect(frame?.url().startsWith(siteHost("http://site-c.test/"))).toBe(true);
});

test("a wrong host moves to the right one", async ({ page }) => {
  await page.goto(`${SITE_A}/~/https/site-b.test/`);
  await page.waitForURL(`${SITE_B}/~/https/site-b.test/`);
  await expect(page.locator("h1")).toHaveText("Site B");
});

test("a root proxy address opens on its site's host", async ({ page }) => {
  await page.goto("/~/https/site-b.test/target");
  await page.waitForURL(`${SITE_B}/~/https/site-b.test/target`);
  await expect(page.locator("h1")).toHaveText("Target");
  expect((await page.request.get(`${SITES}/_g/r/https/site-b.test/`)).status()).toBe(404);
});

test("site hosts serve no admin or UI paths and unknown hosts serve nothing", async ({ page }) => {
  for (const path of ["/_g/admin/settings", "/_g/login", "/settings"]) {
    expect((await page.request.get(`${SITE_A}${path}`)).status(), path).toBe(404);
  }
  expect(await statusFor(`zzzz.${new URL(SITES).host}`, "/")).toBe(404);
});

test("a site's requests to another site carry only cookies set inside it", async ({ page }) => {
  const prefs = (blockThirdPartyCookies: boolean) =>
    page.request.post(`${SITES}/_g/prefs`, { data: { blockThirdPartyCookies }, headers: { origin: SITES } });
  expect((await prefs(false)).status()).toBe(204);
  try {
    await page.goto("/~/https/site-a.test/sites/set-cookie");
    await expect(page.locator("p")).toHaveText("set");
    await page.goto("/~/https/site-b.test/sites/fetch-a");
    await expect(page.locator("#seen")).toHaveText(/^seen: /);
    await expect(page.locator("#seen")).not.toContainText("a=1");
    await page.goto("/~/https/site-a.test/sites/whoami");
    await expect(page.locator("#cookie")).toContainText("a=1");
  } finally {
    await prefs(true);
  }
});

test("settings reach an open site on its next load", async ({ page, context }) => {
  await page.goto("/~/https/site-a.test/keys");
  await expect(page.locator("girici-bar")).toHaveCount(1);
  const settings = await context.newPage();
  await settings.goto("/settings");
  const saved = settings.waitForResponse((res) => res.url().endsWith("/_g/prefs") && res.status() === 204);
  await settings.getByRole("switch", { name: "Show toolbar on sites" }).click();
  await saved;
  await page.reload();
  await expect(page.locator("#keys")).toBeVisible();
  await expect(page.locator("girici-bar")).toHaveCount(0);
});

test("clear all empties every visited host", async ({ page, browserName }) => {
  test.skip(
    browserName === "webkit",
    "WebKit keeps the localStorage a proxied page wrote when Clear-Site-Data follows it on that host",
  );
  await page.goto("/~/https/site-a.test/sites/storage?set=1");
  await expect(page.locator("#ls")).toHaveText("v");
  await page.goto("/~/https/site-b.test/sites/storage?set=1");
  await expect(page.locator("#ls")).toHaveText("v");
  await page.goto("/settings");
  const card = page.locator("section", { hasText: "Site data" });
  await card.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByRole("status")).toHaveText("Cleared 2 sites.");
  await page.goto("/~/https/site-a.test/sites/storage");
  await expect(page.locator("#ls")).toHaveText("null");
  await page.goto("/~/https/site-b.test/sites/storage");
  await expect(page.locator("#ls")).toHaveText("null");
});
