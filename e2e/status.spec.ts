import { expect, QUOTA, signIn, test } from "./support/test.ts";

// One sign-in per browser on this server, which allows five a minute from 127.0.0.1.
test("the admin sees the instance's traffic and limits in Settings", async ({ page }) => {
  await signIn(page, QUOTA);
  await page.goto(`${QUOTA}/settings`);
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.getByText("Bandwidth limit: 1 MB per minute per visitor")).toBeVisible();
  await expect(page.getByText("Daily quota: Off")).toBeVisible();
  await expect(page.getByText("Metrics endpoint: On")).toBeVisible();
  await expect(page.getByRole("table", { name: "Last 30 days" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Data sent in the last hour/ })).toBeVisible();
});
