import { expect, openThroughUi, test } from "./support/test.ts";

test("clears one site from Settings and keeps the others", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/storage?set=a");
  await page.goto("/~/https/site-a.test/cookie/login");
  await expect(page.locator("#server")).toHaveText("sid=abc; theme=dark");
  await page.goto("/~/https/site-b.test/storage?set=b");
  await expect(page.locator("#value")).toHaveText("b");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Clear site-a.test" }).click();
  await expect(page.getByRole("button", { name: "Clear site-a.test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear site-b.test" })).toBeVisible();

  await page.goto("/~/https/site-a.test/storage");
  await expect(page.locator("#value")).toHaveText("");
  await expect(page.locator("#session")).toHaveText("");
  await page.goto("/~/https/site-a.test/cookie/whoami");
  await expect(page.locator("#server")).toHaveText("");
  await page.goto("/~/https/site-b.test/storage");
  await expect(page.locator("#value")).toHaveText("b");
});

test("clears every site at once", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/storage?set=a");
  await page.goto("/~/https/site-b.test/storage?set=b");
  await page.goto("/settings");
  // The History card has its own "Clear all", so the click stays inside the Site data card.
  const card = page.locator("section", { hasText: "Site data" });
  await card.getByRole("button", { name: "Clear all" }).click();
  await expect(card.getByText("No site data yet.")).toBeVisible();
});
