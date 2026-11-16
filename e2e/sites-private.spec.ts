import { expect, PRIVATE_SITES, siteHost, test } from "./support/test.ts";

const SITE_A = siteHost("https://site-a.test/", PRIVATE_SITES);
const SITE_B = siteHost("https://site-b.test/", PRIVATE_SITES);

// Sign-in allows five attempts a minute per address on this server, so each browser signs in once.
test("a signed-out deep link signs in on the root and comes back", async ({ page }) => {
  await page.goto(`${SITE_A}/~/https/site-a.test/`);
  await page.waitForURL(`${PRIVATE_SITES}/_g/login?next=*`);
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${SITE_A}/~/https/site-a.test/`);
  await expect(page.locator("h1")).toHaveText("Site A");
  expect((await page.request.get(`${PRIVATE_SITES}/_g/r/https/site-a.test/`)).status()).toBe(404);

  // An admin signed in before subdomain mode holds only the admin cookie. A root proxy address adds the site session.
  await page.context().clearCookies({ name: "girici-site" });
  await page.goto(`${PRIVATE_SITES}/~/https/site-a.test/target`);
  await page.waitForURL(`${SITE_A}/~/https/site-a.test/target`);
  await expect(page.locator("h1")).toHaveText("Target");

  // A site host's own address sends such an admin to the root, whose UI adds the site session; the link then opens.
  await page.context().clearCookies({ name: "girici-site" });
  await page.goto(`${SITE_B}/~/https/site-b.test/`);
  await page.waitForURL(`${PRIVATE_SITES}/`);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.goto(`${SITE_B}/~/https/site-b.test/`);
  await expect(page.locator("h1")).toHaveText("Site B");
});
