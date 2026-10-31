import { expect, INSTANCE, test } from "./support/test.ts";

test("every visitor sees the instance's name and logo", async ({ page }) => {
  await page.goto(`${INSTANCE}/`);
  await expect(page.locator("header")).toContainText("Kütüphane Ağı");
  const logo = page.locator('header img[src^="/_g/brand/logo?v="]');
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page).toHaveTitle("Kütüphane Ağı");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^\/_g\/brand\/logo\?v=/);
  await page.goto(`${INSTANCE}/_g/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Kütüphane Ağı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Source code · AGPL-3.0" })).toHaveAttribute("href", "/_g/source");
});

test("a logo opened on its own runs no script", async ({ page }) => {
  await page.goto(`${INSTANCE}/_g/brand/logo`);
  expect(await page.evaluate(() => document.title)).not.toBe("ran");
});
