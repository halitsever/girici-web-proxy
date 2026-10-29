import { expect, openThroughUi, test } from "./support/test.ts";

test.afterEach(async ({ page }) => {
  // The fixture server keeps its database for the whole run, so the list must not leak into later tests.
  await page.request.post("/_g/admin/settings", {
    data: { blockedHosts: [] },
    headers: { origin: "http://127.0.0.1:41000" },
  });
});

// Sign-in allows five attempts a minute per address and every browser runs from 127.0.0.1, so one sign-in per
// browser covers both the return to Account and the blocklist.
test("an admin signs in from Account, lands back on it, and blocks a site", async ({ page }) => {
  await page.goto("/account");
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://127.0.0.1:41000/account");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Blocked sites").fill("blocked.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await openThroughUi(page, "https://www.blocked.test/");
  await expect(page.getByText("www.blocked.test is blocked on this Girici server.")).toBeVisible();
});
