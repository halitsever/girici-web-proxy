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

type Natives = Window & { __native: { push: History["pushState"]; fetch: typeof fetch } };

test("judges a page by the address it loaded, not one it pushed", async ({ page, context }) => {
  await page.addInitScript(() => {
    (window as unknown as Natives).__native = { push: History.prototype.pushState, fetch: window.fetch };
  });
  const siteB = await context.newPage();
  await siteB.goto("/~/https/site-b.test/cookie/set");
  await expect(siteB.getByText("set")).toBeVisible();
  await siteB.goto("/~/https/site-b.test/cookie/whoami");
  // Site B's own requests carry its cookie, so its absence below is the verdict and not a missing cookie.
  expect(await siteB.evaluate(() => fetch("/cookie/echo").then((r) => r.text()))).toBe("tp=1");

  await openThroughUi(page, "https://site-a.test/cookie/whoami");
  const sent = await page.evaluate(async () => {
    const native = (window as unknown as Natives).__native;
    native.push.call(history, null, "", "/~/https/site-b.test/cookie/whoami");
    document.cookie = "moved=1; path=/";
    const response = await native.fetch.call(window, "/~/https/site-b.test/cookie/echo", { credentials: "include" });
    return response.text();
  });
  // Third-party cookies are blocked by default, so a request judged as site A's carries no site B cookie.
  expect(sent).toBe("");

  const siteA = await context.newPage();
  await expect
    .poll(async () => {
      await siteA.goto("/~/https/site-a.test/cookie/whoami");
      return siteA.locator("#server").textContent();
    })
    .toContain("moved=1");
  expect(await siteB.evaluate(() => fetch("/cookie/echo").then((r) => r.text()))).toBe("tp=1");
  expect(await siteB.evaluate(() => document.cookie)).not.toContain("moved");
});
