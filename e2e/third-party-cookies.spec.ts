import type { Page } from "@playwright/test";
import { expect, isSiteProject, openThroughUi, siteHost, test } from "./support/test.ts";

async function setThirdPartyCookie(page: Page) {
  await openThroughUi(page, "https://site-b.test/cookie/set");
  await expect(page.getByText("set")).toBeVisible();
}

test("blocks third-party cookies by default and keeps first-party ones", async ({ page }) => {
  await setThirdPartyCookie(page);
  await page.goto("/~/https/site-a.test/third-party");
  await expect(page.locator("#fetch")).toHaveText("none");
  await expect(page.frameLocator("#tp").locator("#server")).toHaveText("");
  await page.goto("/~/https/site-b.test/cookie/whoami");
  await expect(page.locator("#server")).toHaveText("tp=1");
});

test("sends third-party cookies when the switch is off", async ({ page }) => {
  test.skip(
    isSiteProject(test.info()),
    "Each site host keeps its own jar, so third-party cookies are partitioned per embedding site even when allowed",
  );
  await setThirdPartyCookie(page);
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Block third-party cookies" }).click();
  await expect(page.getByText("With this off, any site you open can send requests to your other sites")).toBeVisible();
  await openThroughUi(page, "https://site-a.test/third-party");
  await expect(page.locator("#fetch")).toHaveText("tp=1");
  await expect(page.frameLocator("#tp").locator("#server")).toHaveText("tp=1");
});

test("keeps cookies on a worker's requests to its own site", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/site-a.test/worker-cookie");
  await expect(page.locator("#worker")).toHaveText("sid=abc; theme=dark");
});

test("keeps cookies on module and blob workers' requests to their own site", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/site-a.test/worker-kinds");
  for (const id of ["#module", "#blob"]) await expect(page.locator(id)).toHaveText("sid=abc; theme=dark");
});

test("keeps cookies on a nested worker's requests to its own site", async ({ page, browserName }) => {
  test.skip(
    browserName === "chromium",
    "Chromium sends a nested dedicated worker's requests without a client ID, so it cannot be bound",
  );
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/site-a.test/worker-kinds");
  await expect(page.locator("#nested")).toHaveText("sid=abc; theme=dark");
});

test("keeps cookies on the requests of a worker a blank frame started", async ({ page, browserName }) => {
  test.skip(browserName === "chromium", "Chromium leaves blank frames and their workers outside the service worker");
  await openThroughUi(page, "https://site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/site-a.test/blank-worker");
  await expect(page.locator("#worker")).toHaveText("sid=abc; theme=dark");
});

test("a worker cannot borrow another site's cookies with a forged referrer", async ({ page, baseURL }) => {
  await setThirdPartyCookie(page);
  // The forged referrer names the worker's own origin, which in subdomain mode is site-a's host.
  const proxy = isSiteProject(test.info()) ? siteHost("https://site-a.test/") : baseURL;
  await page.goto(`/~/https/site-a.test/worker-forge?proxy=${proxy}`);
  await expect(page.locator("#worker")).toHaveText("none");
  await page.goto(`/~/https/site-a.test/worker-forge?proxy=${proxy}&nested=1`);
  await expect(page.locator("#worker")).toHaveText("none");
});
