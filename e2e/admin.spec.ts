import { expect, openThroughUi, test } from "./support/test.ts";

test.afterEach(async ({ page }) => {
  // The fixture server keeps its database for the whole run, so the list must not leak into later tests.
  await page.request.post("/_g/admin/settings", {
    data: { blockedHosts: [], currentPassword: "e2e-password" },
    headers: { origin: "http://127.0.0.1:41000" },
  });
});

// Sign-in allows five attempts a minute per address and every browser runs from 127.0.0.1, so one sign-in per
// browser covers the return to Account, the blocklist and the admin API probe.
test("an admin signs in, blocks a site, and proxied pages cannot use the admin API", async ({ page, browserName }) => {
  await page.goto("/account");
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://127.0.0.1:41000/account");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  // After a password change the page must confirm the next save with the new password. One browser covers it, since
  // all browsers share the admin's write limit of ten a minute.
  if (browserName === "chromium") {
    const accountWrite = () =>
      page.waitForResponse((res) => res.url().endsWith("/_g/account") && res.request().method() === "POST");
    const changePassword = async (next: string) => {
      await page.getByLabel("New password").fill(next);
      await page.getByLabel("Confirm").fill(next);
      const [res] = await Promise.all([accountWrite(), page.getByRole("button", { name: "Change password" }).click()]);
      expect(res.status()).toBe(200);
    };
    await page.getByLabel("Current password").fill("e2e-password");
    await changePassword("e2e-password-2");
    const [saved] = await Promise.all([accountWrite(), page.getByRole("button", { name: "Save changes" }).click()]);
    expect(saved.status()).toBe(200);
    await changePassword("e2e-password");
  }

  await page.goto("/settings");
  await page.getByLabel("Current password").fill("e2e-password");
  await page.getByLabel("Blocked sites").fill("blocked.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await openThroughUi(page, "https://www.blocked.test/");
  await expect(page.getByText("www.blocked.test is blocked on this Girici server.")).toBeVisible();

  await openThroughUi(page, "https://site-a.test/admin-probe?proxy=http://127.0.0.1:41000");
  await expect(page.locator("#result")).not.toBeEmpty();
  const probe = JSON.parse((await page.locator("#result").textContent()) ?? "{}");
  expect(probe.hooked).toBe("404 not found");
  expect(probe.rawPost).toBe(404);
  expect(probe.rawGet).toBe(404);
});
