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
