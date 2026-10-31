import { expect, openThroughUi, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/nav");
});

test("keeps absolute and protocol-relative links inside the proxy", async ({ page }) => {
  await page.click("#abs");
  await expect(page).toHaveURL(/\/~\/https\/site-b\.test\/$/);
  await expect(page.locator("h1")).toHaveText("Site B");
  await page.goBack();
  await page.click("#proto");
  await expect(page).toHaveURL(/\/~\/https\/www\.site-a\.test\/landing$/);
});

for (const id of ["assign", "href", "replace"]) {
  test(`keeps location.${id} navigation inside the proxy`, async ({ page }) => {
    await page.click(`#${id}`);
    await expect(page).toHaveURL(/\/~\/https\/site-b\.test\/$/);
    await expect(page.locator("h1")).toHaveText("Site B");
  });
}

test("opens windows through the proxy", async ({ page }) => {
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  const opened = await popup;
  await expect(opened).toHaveURL(/\/~\/https\/site-b\.test\/$/);
  await expect(opened.locator("h1")).toHaveText("Site B");
});

test("submits forms through the proxy", async ({ page }) => {
  await page.click("#get-go");
  await expect(page).toHaveURL(/\/~\/https\/site-b\.test\/search\?q=hello$/);
  await expect(page.locator("#query")).toHaveText("hello");
  await page.goBack();
  await page.click("#post-go");
  await expect(page.locator("#echo")).toHaveText("POST q=posted");
});

test("submits forms from script", async ({ page }) => {
  await page.click("#submit");
  await expect(page.locator("#echo")).toHaveText("POST q=posted");
});

test("keeps the method across 307 and switches to GET on 303", async ({ page, browserName }) => {
  await page.click("#post-307-go");
  // WebKit resends a POST navigation that a service worker redirects with 307 without its body.
  await expect(page.locator("#echo")).toHaveText(browserName === "webkit" ? "POST" : "POST q=kept");
  await page.goBack();
  await page.click("#post-303-go");
  await expect(page.locator("#echo")).toHaveText("GET");
});

test("stays in the proxy when a pushed URL is reloaded", async ({ page }) => {
  await page.click("#push");
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/pushed\?x=1$/);
  await page.reload();
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/pushed\?x=1$/);
  await expect(page.locator("body")).toContainText("not found");
});

test("follows meta refresh and Refresh headers inside the proxy", async ({ page }) => {
  await page.goto("/~/https/site-a.test/meta-refresh");
  await expect(page).toHaveURL(/\/~\/https\/site-b\.test\/$/);
  await page.goto("/~/https/site-a.test/refresh-header");
  await expect(page).toHaveURL(/\/~\/https\/site-b\.test\/$/);
});

test("loads iframes through the proxy", async ({ page }) => {
  const frame = page.frameLocator("#frame");
  await expect(frame.locator("h1")).toHaveText("Frame");
  const results = JSON.parse((await frame.locator("#frame-results").textContent()) ?? "{}");
  expect(results).toEqual({ href: "https://site-b.test/frame", parent: "SecurityError" });
});

test("resolves URLs against <base>, srcset and stylesheets", async ({ page }) => {
  await page.goto("/~/https/site-a.test/base");
  await expect.poll(() => page.locator("#based").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await page.goto("/~/https/site-a.test/media");
  await expect(page.locator('img#srcset[srcset^="/~/https/cdn.site-a.test/"]')).toHaveCount(1);
  await expect.poll(() => page.locator("#srcset").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(page.locator("#inline")).toHaveCSS("background-image", /\/~\/https\/cdn\.site-a\.test\/b\.png/);
  await expect(page.locator("#external")).toHaveCSS("background-image", /\/~\/https\/cdn\.site-a\.test\/b\.png/);
});

test("keeps a blank popup the page navigates later inside the proxy", async ({ page }) => {
  const popup = page.waitForEvent("popup");
  await page.click("#blank-popup");
  const opened = await popup;
  await expect(opened.locator("h1")).toHaveText("Site B");
  await expect(opened).toHaveURL(/\/~\/https\/site-b\.test\/$/);
});

test("keeps script navigation of a blank frame inside the proxy", async ({ page }) => {
  await page.click("#blank-frame");
  await expect(page.frameLocator("#blank").locator("h1")).toHaveText("Site B");
});
