import { expect, openThroughUi, test } from "./support/test.ts";

test("a burst of cookie writes followed by a link lands with the last value", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie-burst");
  await page.click("#next");
  await page.waitForURL(/\/~\/https\/site-a\.test\/cookie-seen$/);
  const seen = (await page.locator("#seen").textContent()) ?? "";
  expect(seen).toMatch(/(^|; )n=40(;|$)/);
  expect(seen.match(/(^|; )n=/g)).toHaveLength(1);
});
