import { expect, test } from "./support/test.ts";

// The page then stays put after Enter, so the test can read what it saved.
test.use({ serviceWorkers: "block" });

test("keeps a search out of the recent sites", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("URL or search");
  await box.fill("cats");
  await box.press("Enter");
  await expect(page.getByText(/^(Opening|Could not start)/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("girici:history"))).toBeNull();
});
