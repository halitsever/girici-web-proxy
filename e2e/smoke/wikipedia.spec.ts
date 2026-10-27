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
  const path = testInfo.outputPath("page.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("page", { path, contentType: "image/png" });
});

test("navigates Wikipedia inside the proxy", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openThroughUi(page, "https://en.wikipedia.org/wiki/Web_proxy");
  await expect(page.locator("#firstHeading")).toBeVisible({ timeout: 30_000 });
  // Web_proxy redirects to the Proxy server article, so the first article link in its text is followed instead.
  await page.locator("#mw-content-text p a[href*='/wiki/']:not([href*=':'])").first().click();
  await expect(page).toHaveURL(/\/~\/https\/en\.wikipedia\.org\/wiki\/(?!Web_proxy)/, { timeout: 30_000 });
  await page.goBack();
  // MediaWiki replaces a redirect's URL with the target title through history.replaceState.
  await expect(page).toHaveURL(/\/~\/https\/en\.wikipedia\.org\/wiki\/(?:Web_proxy|Proxy_server)/);
  await page.locator("input[name='search']").first().fill("Tor networ");
  await expect(page.locator(".cdx-menu-item").first()).toBeVisible({ timeout: 30_000 });
  const path = testInfo.outputPath("search.png");
  await page.screenshot({ path });
  await testInfo.attach("search", { path, contentType: "image/png" });
});
