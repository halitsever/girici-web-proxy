import { expect, test } from "./support/test.ts";

// A wrong code never creates the admin, so this stays repeatable across browsers and reruns.
test("setup asks for the code from the server log and refuses a wrong one", async ({ page }) => {
  await page.goto("http://127.0.0.1:41001/");
  await page.waitForURL("http://127.0.0.1:41001/_g/setup");
  await page.getByLabel("Setup code").fill("WRONG-CODE-0000");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Name", { exact: true }).fill("Admin");
  await page.getByLabel("Email").fill("admin@test.local");
  await page.getByLabel("Password").fill("fresh-password");
  await page.getByRole("button", { name: "Create admin" }).click();
  await expect(page.getByText("The setup code is wrong.")).toBeVisible();
});
