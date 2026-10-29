import { expect, openThroughUi, test } from "./support/test.ts";

test("shows the toolbar on top-level proxied pages only", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/nav");
  await expect(page.locator("girici-bar")).toHaveCount(1);
  await expect(page.frameLocator("iframe#frame").locator("body")).toBeVisible();
  await expect(page.frameLocator("iframe#frame").locator("girici-bar")).toHaveCount(0);
});

test("opens the address field on the real URL and navigates from it", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/keys");
  await page.getByRole("button", { name: "Girici toolbar" }).click();
  const address = page.getByRole("textbox", { name: "Address" });
  await expect(address).toHaveValue("https://site-a.test/keys");
  await address.fill("site-b.test");
  await address.press("Enter");
  await page.waitForURL("**/~/https/site-b.test/");
});

test("keeps keystrokes in the address field away from the page", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/keys");
  await page.getByRole("button", { name: "Girici toolbar" }).click();
  await page.getByRole("textbox", { name: "Address" }).pressSequentially("kf/");
  await expect(page.locator("#keys")).toHaveText("0");
});

test("takes the user back to Girici", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/keys");
  await page.getByRole("button", { name: "Girici toolbar" }).click();
  await page.getByRole("button", { name: "Girici home" }).click();
  await page.waitForURL("http://127.0.0.1:41000/");
});

test("comes back after the page replaces its document", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/wipe");
  await expect(page.locator("body#wiped")).toHaveCount(1);
  await expect(page.locator("girici-bar")).toHaveCount(1);
});

test("stays hidden when the Settings switch is off", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Show toolbar on sites" }).click();
  await openThroughUi(page, "https://site-a.test/keys");
  await expect(page.locator("#keys")).toBeVisible();
  await expect(page.locator("girici-bar")).toHaveCount(0);
});

test("clears the current site from the toolbar", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/storage?set=a");
  await page.goto("/~/https/site-a.test/storage");
  await expect(page.locator("#value")).toHaveText("a");
  await page.getByRole("button", { name: "Girici toolbar" }).click();
  await page.getByRole("button", { name: "Clear site data" }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator("#value")).toHaveText("");
});
