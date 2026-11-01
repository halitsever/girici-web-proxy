import { expect, test } from "./support/test.ts";

test("runs every browser with the en-US locale", async ({ page }, testInfo) => {
  // Bundled browsers often report en-US anyway, so the pinned option is checked too: a tr-TR machine must not differ.
  expect(testInfo.project.use.locale).toBe("en-US");
  await page.goto("/");
  expect(await page.evaluate(() => navigator.language)).toBe("en-US");
});
