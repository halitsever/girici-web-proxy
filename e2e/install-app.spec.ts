import { expect, test } from "./support/test.ts";

test("offers to install the app only while the browser does", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Show toolbar on sites")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);

  // Playwright cannot make a browser offer an install, so the test fires the event the browser would.
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: () => {
        (window as unknown as { prompted: boolean }).prompted = true;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  const button = page.getByRole("button", { name: "Install", exact: true });
  await button.click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await expect(button).toHaveCount(0);
});
