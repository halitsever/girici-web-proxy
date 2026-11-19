import { expect, test } from "./support/test.ts";

test("focuses the address box on load and on the slash key", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("URL or search");
  await expect(box).toBeFocused();
  await box.blur();
  await page.keyboard.press("/");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("");
});

test("leaves a slash typed into the box alone", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("URL or search");
  await box.fill("example.com");
  await box.press("/");
  await expect(box).toHaveValue("example.com/");
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("does not focus the box, which would cover the page with the keyboard", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "only Chromium emulates a coarse pointer");
    await page.goto("/");
    const box = page.getByLabel("URL or search");
    await expect(box).toBeVisible();
    await expect(box).not.toBeFocused();
  });
});
