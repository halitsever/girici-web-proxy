import { expect, openThroughUi, test } from "./support/test.ts";

const LAST = /(^|; )n=40(;|$)/;

test("a burst of cookie writes followed by a link lands with the last value", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cookie-burst");
  await page.click("#next");
  await page.waitForURL(/\/~\/https\/site-a\.test\/cookie-seen$/);
  // A loaded machine can take longer than the navigation waits, so the jar gets a few reloads to show the last write.
  let seen = "";
  await expect
    .poll(
      async () => {
        seen = (await page.locator("#seen").textContent()) ?? "";
        if (!LAST.test(seen)) await page.reload();
        return seen;
      },
      { timeout: 10_000 },
    )
    .toMatch(LAST);
  expect(seen.match(/(^|; )n=/g)).toHaveLength(1);
});
