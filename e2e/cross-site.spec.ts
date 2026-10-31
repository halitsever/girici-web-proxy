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

test("shows a storage change only to windows of the site that made it", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/storage-events");
  const other = await context.newPage();
  await other.goto("/~/https/site-b.test/storage-events");
  const writer = await context.newPage();
  await writer.goto("/~/https/site-a.test/storage?set=v1");
  await expect(page.locator("#events")).toHaveText('["k","v1",true]');
  // A storage event reaches every window of the origin in the same task, so the other site's has had its chance.
  await writer.goto("/~/https/site-a.test/storage?set=v2");
  await expect(page.locator("#events")).toContainText('["k","v2",true]');
  await expect(other.locator("#events")).toHaveText("");
});
