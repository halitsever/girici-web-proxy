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
