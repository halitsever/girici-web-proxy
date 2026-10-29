import type { Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

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
  await setThirdPartyCookie(page);
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Block third-party cookies" }).click();
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
