import { expect, openThroughUi, test } from "../support/test.ts";

test("opens a Wikipedia article", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openThroughUi(page, "https://en.wikipedia.org/wiki/Web_proxy");
  await expect(page.locator("#firstHeading")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        page
          .locator("img")
          .evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await testInfo.attach("page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
