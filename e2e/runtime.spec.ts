import { expect, openThroughUi, test } from "./support/test.ts";

test("shows pages their real location", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  await page.click("#to-runtime");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    href: "https://site-a.test/runtime?x=1#h",
    origin: "https://site-a.test",
    host: "site-a.test",
    pathname: "/runtime",
    windowOrigin: "https://site-a.test",
    url: "https://site-a.test/runtime?x=1#h",
    documentURI: "https://site-a.test/runtime?x=1#h",
    baseURI: "https://site-a.test/runtime?x=1#h",
    domain: "site-a.test",
    referrer: "https://site-a.test/",
    linkHref: "https://site-b.test/x?y=1",
    linkAttr: "https://site-b.test/x?y=1",
    linkHost: "site-b.test",
    isLocation: true,
    sameObject: true,
    serviceWorker: "masked",
    controller: null,
    pushed: "https://site-a.test/runtime/pushed?z=2",
    linkAfterSet: "https://site-c.test/",
  });
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/runtime\/pushed\?z=2$/);
  await expect(page.locator('a#link[href="/~/https/site-c.test/"]')).toHaveCount(1);
});
