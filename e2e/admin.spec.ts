import type { Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

async function signIn(page: Page) {
  await page.goto("/_g/login");
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://127.0.0.1:41000/");
}

test.afterEach(async ({ page }) => {
  // The fixture server keeps its database for the whole run, so the list must not leak into later tests.
  await page.request.post("/_g/admin/settings", {
    data: { blockedHosts: [] },
    headers: { origin: "http://127.0.0.1:41000" },
  });
});

test("an admin blocks a site from Settings", async ({ page, browserName }) => {
  test.skip(
    browserName === "webkit",
    "WebKit drops the Secure session cookie on http://127.0.0.1, so sign-in does not stick",
  );
  await signIn(page);
  await page.goto("/settings");
  await page.getByLabel("Blocked sites").fill("blocked.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await openThroughUi(page, "https://www.blocked.test/");
  await expect(page.getByText("www.blocked.test is blocked on this Girici server.")).toBeVisible();
});
