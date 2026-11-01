import { expect, INSTANCE, openThroughUi, signIn, test } from "./support/test.ts";

test("a visitor who follows a shared link sees the warning once", async ({ page }) => {
  await page.goto(`${INSTANCE}/~/https/site-a.test/`);
  await expect(page.getByRole("heading", { name: "This page opens through Girici" })).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to site-a.test" }).click();
  await expect(page.locator("#title")).toHaveText("Site A");
  await page.goto(`${INSTANCE}/~/https/site-b.test/`);
  await expect(page.getByRole("heading", { name: "Site B" })).toBeVisible();
});

test("a browser that opened Girici first never sees the warning", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: INSTANCE });
  try {
    const page = await context.newPage();
    await openThroughUi(page, "https://site-a.test/");
    await expect(page.locator("#title")).toHaveText("Site A");
    await page.goto("/~/https/site-b.test/");
    await expect(page.getByRole("heading", { name: "Site B" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a shared link to the sign-in page does not skip the warning", async ({ page }) => {
  await page.goto(`${INSTANCE}/_g/login?next=/~/https/site-a.test/`);
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.goto(`${INSTANCE}/~/https/site-a.test/`);
  await expect(page.getByRole("heading", { name: "This page opens through Girici" })).toBeVisible();
});

test("the admin turns the warning off", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "shared admin write limit");
  await signIn(page, INSTANCE);
  try {
    await page.goto(`${INSTANCE}/settings`);
    await page.getByLabel("Current password").fill("e2e-password");
    const warn = page.getByRole("switch", { name: "Warn before shared links" });
    await expect(warn).toBeChecked();
    await warn.click();
    await expect(warn).not.toBeChecked();

    const visitor = await browser.newContext();
    try {
      const other = await visitor.newPage();
      await other.goto(`${INSTANCE}/~/https/site-a.test/`);
      await expect(other.locator("#title")).toHaveText("Site A");
    } finally {
      await visitor.close();
    }
  } finally {
    await page.request.post(`${INSTANCE}/_g/admin/settings`, {
      data: { deepLinkWarning: true, currentPassword: "e2e-password" },
      headers: { origin: INSTANCE },
    });
  }
});
