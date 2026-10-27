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

test("keeps web storage apart per site", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/storage?set=a");
  await expect(page.locator("#value")).toHaveText("a");
  await expect(page.locator("#session")).toHaveText("a");
  await page.goto("/~/https/site-b.test/storage");
  await expect(page.locator("#value")).toHaveText("");
  await expect(page.locator("#session")).toHaveText("");
  await page.goto("/~/https/site-a.test/storage");
  await expect(page.locator("#value")).toHaveText("a");
});

test("shows real URLs on network responses", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/network");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    fetchUrl: "https://site-b.test/api",
    fetchBody: { method: "GET", origin: "https://site-a.test" },
    rootUrl: "https://site-a.test/api",
    rootRedirected: false,
    requestUrl: "https://site-a.test/api",
    xhrUrl: "https://site-b.test/api",
    events: ["one", "two"],
    eventSourceUrl: "https://site-a.test/sse",
  });
});
