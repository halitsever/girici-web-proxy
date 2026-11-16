import { expect, test } from "./support/test.ts";

test("runs every browser with the en-US locale", async ({ page }, testInfo) => {
  // Bundled browsers often report en-US anyway, so the pinned option is checked too: a tr-TR machine must not differ.
  expect(testInfo.project.use.locale).toBe("en-US");
  await page.goto("/");
  expect(await page.evaluate(() => navigator.language)).toBe("en-US");
});

test("carries the language picked in Settings to the toolbar", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "Ayarlar" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("tr");
  await page.goto("/");
  const input = page.getByLabel("URL ya da arama");
  await input.fill("https://site-a.test/keys");
  await input.press("Enter");
  await page.waitForURL(/\/~\//);
  await expect(page.locator("#girici-boot")).toHaveCount(0);
  await page.getByRole("button", { name: "Girici araç çubuğu" }).click();
  await expect(page.getByRole("textbox", { name: "Adres" })).toHaveValue("https://site-a.test/keys");
});

test.describe("in a Turkish browser", () => {
  test.use({ locale: "tr-TR" });

  test("shows the UI in Turkish until Settings says otherwise", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Ayarlar" })).toBeVisible();
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
