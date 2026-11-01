import { expect, GATES, signIn, test } from "./support/test.ts";

test("a first visit with the warning and the browser check on", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "shared admin write limit");
  await signIn(page, GATES);
  try {
    await page.goto(`${GATES}/settings`);
    await page.getByLabel("Current password").fill("e2e-password");
    const warn = page.getByRole("switch", { name: "Warn before shared links" });
    await expect(warn).not.toBeChecked();
    await warn.click();
    // The switch flips before the server answers, so wait for the instance to report it.
    await expect
      .poll(async () => (await (await page.request.get(`${GATES}/_g/auth/state`)).json()).deepLinkWarning)
      .toBe(true);

    const visitor = await browser.newContext();
    try {
      const other = await visitor.newPage();
      const visited: string[] = [];
      other.on("framenavigated", (frame) => {
        if (frame === other.mainFrame()) visited.push(frame.url());
      });
      await other.goto(`${GATES}/~/https/site-a.test/`);
      await expect(other.getByRole("heading", { name: "This page opens through Girici" })).toBeVisible();
      await other.getByRole("button", { name: "Continue to site-a.test" }).click();
      await expect(other.locator("#title")).toHaveText("Site A", { timeout: 20_000 });
      expect(visited.some((url) => url.startsWith(`${GATES}/_g/challenge?next=`))).toBe(true);
    } finally {
      await visitor.close();
    }
  } finally {
    await page.request.post(`${GATES}/_g/admin/settings`, {
      data: { deepLinkWarning: false, currentPassword: "e2e-password" },
      headers: { origin: GATES },
    });
  }
});
