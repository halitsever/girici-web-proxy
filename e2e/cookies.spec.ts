import { expect, openThroughUi, test } from "./support/test.ts";

test("keeps cookies from a redirect for the site and its subdomains only", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/cookie\/whoami$/);
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/www.site-a.test/cookie/whoami");
  await expect(page.locator("#server")).toHaveText("theme=dark");
  await page.goto("/~/https/site-b.test/cookie/whoami");
  await expect(page.locator("#server")).toHaveText("");
});

test("keeps cookies when the service worker restarts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium can stop service workers on demand");
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  // Lets the 50 ms write debounce reach IndexedDB before the worker stops.
  await page.waitForTimeout(200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await page.reload();
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
});

test("shows scripts their own cookies but never HttpOnly ones", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#client")).toHaveText("theme=dark");
});

test("sends cookies a script just set", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/script");
  await expect(page.locator("#echo")).toHaveText("js=1");
});

test("updates document.cookie from fetch responses", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/api-page");
  await expect(page.locator("#after")).toHaveText("api=1");
});

test("no longer announces cookie changes on a shared channel", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/old-channel");
  const other = await context.newPage();
  await other.goto("/~/https/site-a.test/cookie/whoami");
  await other.evaluate(() => {
    document.cookie = "shared=1; path=/";
  });
  // The verdict starts only once the write has reached the worker's jar.
  await expect.poll(() => page.evaluate(() => fetch("/cookie/echo").then((r) => r.text()))).toContain("shared=1");
  await page.locator("#judge").click();
  await expect(page.locator("#heard")).toHaveText("no");
});

test("shares cookie changes with other tabs", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/cookie/whoami");
  const other = await context.newPage();
  await other.goto("/~/https/site-a.test/cookie/whoami");
  await other.evaluate(() => {
    document.cookie = "shared=1; path=/cookie";
  });
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("shared=1");
});
