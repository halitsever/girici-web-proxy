import { expect, openThroughUi, test } from "./support/test.ts";

test("refuses another site's popup document but keeps messaging and navigation", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cross-popup");
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  await (await popup).waitForLoadState();
  await page.click("#check");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    document: "SecurityError",
    storage: "SecurityError",
    closed: false,
    posted: true,
  });
});

test("keeps an embedded site's storage per top site and a same-site frame on its own storage", async ({ page }) => {
  await openThroughUi(page, "https://site-b.test/storage?set=b");
  await page.goto("/~/https/www.site-a.test/storage?set=w");
  await page.goto("/~/https/site-a.test/embed-storage");
  await expect(page.frameLocator("#b").locator("#value")).toHaveText("");
  await expect(page.frameLocator("#www").locator("#value")).toHaveText("w");
});

test("keeps the sender of a cross-site frame's messages when the page touched it first", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/pm-touch");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    readyOrigin: "https://site-b.test",
    readyFromChild: true,
    pingFromParent: true,
    pingOrigin: "https://site-a.test",
  });
});

test("refuses a cross-site frame's static top access", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/top-host");
  await expect(page.locator("#top")).toHaveText("SecurityError");
});
