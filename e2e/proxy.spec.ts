import { expect, openThroughUi, test } from "./support/test.ts";

test("the trap records requests that leave the proxy", async ({ page }) => {
  await page.goto("https://site-b.test/").catch(() => {});
  const log = (await (await fetch("http://127.0.0.1:41999/log")).json()) as string[];
  expect(log.some((entry) => entry.includes("site-b.test"))).toBe(true);
  await fetch("http://127.0.0.1:41999/log", { method: "DELETE" });
});

test("loads a fixture page through the UI", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  await expect(page.locator("#title")).toHaveText("Site A");
  await expect(page.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");
});

test("proxies relative, root-relative, absolute and protocol-relative subresources", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  for (const id of ["relative", "root", "absolute", "protocol-relative"]) {
    await expect.poll(() => page.locator(`#${id}`).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  }
});

test("keeps root-relative navigation inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  await page.click("#page2");
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/page2$/);
  await expect(page.locator("h1")).toHaveText("Page 2");
});

test("maps upstream redirects to proxy URLs", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/redirect-301");
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/target$/);
});

test("follows a cross-host redirect", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/redirect-cross");
  await expect(page).toHaveURL(/\/~\/https\/www\.site-a\.test\/landing$/);
  await expect(page.locator("h1")).toHaveText("Landing");
});

test("bootstraps a direct visit", async ({ page }) => {
  await page.goto("/~/https/site-a.test/");
  await expect(page.locator("#title")).toHaveText("Site A");
});

test("shows an error page for blocked targets", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  await page.goto("/~/http/127.0.0.1/");
  await expect(page.locator("body")).toContainText("does not open local or private network addresses");
});

test("serves plain http sites", async ({ page }) => {
  await openThroughUi(page, "http://site-c.test/");
  await expect(page.locator("h1")).toHaveText("Site C");
});
