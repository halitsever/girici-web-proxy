import { expect, openThroughUi, test } from "./support/test.ts";

test("installs the runtime into blank and srcdoc frames", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/frames");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.blankLocation).toBe("https://site-a.test/frames");
  expect(out.srcdocLinkAttr).toBe("https://site-b.test/x");
  await expect(page.locator("iframe#srcdoc")).toHaveCount(1);
});

test("keeps IndexedDB apart per site", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/idb-store?set=a");
  await expect(page.locator("#value")).toHaveText("a");
  await page.goto("/~/https/site-b.test/idb-store");
  await expect(page.locator("#value")).toHaveText("");
  await page.goto("/~/https/site-a.test/idb-store");
  await expect(page.locator("#value")).toHaveText("a");
});

test("passes postMessage between proxied frames", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/postmessage");
  await expect(page.locator("#got")).toHaveText("hello from https://site-a.test");
});

test("denies notifications", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/notify");
  await expect(page.locator("#perm")).toHaveText("denied");
});

test("contains fetches from a srcdoc script", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/srcdoc-escape");
  await page.waitForTimeout(1500);
  // The escapeGuard fixture asserts zero requests left the proxy.
});

test("does not double-prefix raw attribute reads", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/raw-attr");
  await expect(page.locator("#raw")).toHaveText("https://site-a.test/api");
  await expect(page.locator("#rawnode")).toHaveText("https://site-a.test/api");
  await expect(page.locator("#fetched")).toHaveText("GET");
});
