import type { Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

// /_g/auth/state answers 200 without a session, so 200 means the service worker let the call through.
test("a proxied page renamed to a UI address cannot call the admin API", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__native = {
      push: History.prototype.pushState,
      fetch: window.fetch,
    };
  });
  await openThroughUi(page, "https://site-a.test/");
  const status = await page.evaluate(async () => {
    const native = (window as unknown as { __native: { push: History["pushState"]; fetch: typeof fetch } }).__native;
    native.push.call(history, null, "", "/settings");
    return (await native.fetch.call(window, "/_g/auth/state")).status;
  });
  expect(status).toBe(403);
});

test("a proxied page sent to a UI address stays in its site and cannot call the admin API", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__nativeFetch = window.fetch;
  });
  const adminStatus = () =>
    page.evaluate(async () => {
      const native = (window as unknown as { __nativeFetch: typeof fetch }).__nativeFetch;
      return (await native.call(window, "/_g/auth/state")).status;
    });
  await openThroughUi(page, "https://site-a.test/ui-link");
  await page.locator("#settings").click();
  await expect(page.getByText("site settings")).toBeVisible();
  expect(page.url()).toBe("http://127.0.0.1:41000/~/https/site-a.test/settings");
  expect(await adminStatus()).toBe(403);

  await page.goto("/~/https/site-a.test/ui-link");
  // Code run by evaluate is not rewritten, so this asks for our own /settings with the page as referrer.
  await page.evaluate(() => location.assign("/settings"));
  await expect(page.getByText("site settings")).toBeVisible();
  expect(page.url()).toBe("http://127.0.0.1:41000/~/https/site-a.test/settings");
  expect(await adminStatus()).toBe(403);
});

test("a UI load the server cannot answer shows Girici's error page", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test fail the service worker's own requests");
  await openThroughUi(page, "https://site-a.test/");
  await page.context().route("http://127.0.0.1:41000/settings", (route) => route.abort());
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(502);
  await expect(page.getByText("Girici could not connect to 127.0.0.1:41000.")).toBeVisible();
});

test("the tab that installs the engine can use the admin API at once", async ({ page }) => {
  await page.goto("/");
  const status = await page.evaluate(async () => {
    await navigator.serviceWorker.register("/_g/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
      );
    return (await fetch("/_g/auth/state")).status;
  });
  expect(status).toBe(200);
});

test("the UI keeps admin access after the service worker restarts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium can stop service workers on demand");
  await openThroughUi(page, "https://site-a.test/");
  await page.goto("/settings");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  expect(await page.evaluate(async () => (await fetch("/_g/auth/state")).status)).toBe(200);
});

async function thirdPartyCookieSent(page: Page): Promise<void> {
  // The switch reaches the engine in a message the page does not wait for, so the check retries.
  await expect(async () => {
    await page.goto("/~/https/site-a.test/third-party");
    await expect(page.locator("#fetch")).toHaveText("tp=1", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

test("Settings reached from the home page change the engine", async ({ page }) => {
  await openThroughUi(page, "https://site-b.test/cookie/set");
  await expect(page.getByText("set")).toBeVisible();
  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Block third-party cookies" }).click();
  await thirdPartyCookieSent(page);
});

test("a UI tab loaded around the service worker loads again through it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium can reload a page around its service worker on demand");
  await openThroughUi(page, "https://site-b.test/cookie/set");
  await expect(page.getByText("set")).toBeVisible();
  await page.goto("/settings");
  // The load that goes around the worker is followed by one more, through it.
  let loads = 0;
  const reloaded = new Promise<void>((resolve) => page.on("load", () => ++loads === 2 && resolve()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.reload", { ignoreCache: true });
  await reloaded;
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole("switch", { name: "Block third-party cookies" }).click();
  await thirdPartyCookieSent(page);
});
