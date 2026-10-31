import { expect, INSTANCE, signIn, test } from "./support/test.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// The seeded logo, so the restore leaves the instance as the other tests expect.
const SEEDED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2563eb"/>' +
  '<script>document.title="ran"</script></svg>';

test("every visitor sees the instance's name and logo", async ({ page }) => {
  await page.goto(`${INSTANCE}/`);
  await expect(page.locator("header")).toContainText("Kütüphane Ağı");
  const logo = page.locator('header img[src^="/_g/brand/logo?v="]');
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page).toHaveTitle("Kütüphane Ağı");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^\/_g\/brand\/logo\?v=/);
  await page.goto(`${INSTANCE}/_g/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Kütüphane Ağı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Source code · AGPL-3.0" })).toHaveAttribute("href", "/_g/source");
});

test("a logo opened on its own runs no script", async ({ page }) => {
  await page.goto(`${INSTANCE}/_g/brand/logo`);
  expect(await page.evaluate(() => document.title)).not.toBe("ran");
});

test("an admin renames the instance with the current password", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "shared admin write limit; the display test covers all three browsers");
  await signIn(page, INSTANCE);
  try {
    await page.goto(`${INSTANCE}/settings`);
    await page.getByLabel("Current password").fill("wrong-password");
    await page.getByRole("button", { name: "Save instance" }).click();
    await expect(page.getByText("The current password is wrong")).toBeVisible();

    await page.getByLabel("Current password").fill("e2e-password");
    await page.getByLabel("Instance name").fill("Test Kurulum");
    await page
      .getByLabel("Logo", { exact: true })
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Save instance" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.locator("header")).toContainText("Test Kurulum");
  } finally {
    await page.request.post(`${INSTANCE}/_g/admin/brand`, {
      headers: { origin: INSTANCE },
      data: {
        name: "Kütüphane Ağı",
        logo: { type: "image/svg+xml", data: Buffer.from(SEEDED_SVG).toString("base64") },
        currentPassword: "e2e-password",
      },
    });
  }
});
