import { expect, test } from "./support/test.ts";

// The page then stays put after Enter, so the test can read what it saved.
test.use({ serviceWorkers: "block" });

test("keeps a search out of the recent sites", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("URL or search");
  await box.fill("cats");
  await box.press("Enter");
  await expect(page.getByText(/^(Opening|Could not start)/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("girici:history"))).toBeNull();
});

test("moves a recent site to the front when it is opened again", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const visits = [
      { name: "en.wikipedia.org", t: Date.now() },
      { name: "github.com", t: Date.now() - 5 * 3600_000 },
    ];
    localStorage.setItem("girici:history", JSON.stringify(visits));
  });
  await page.reload();
  await page.getByRole("button", { name: /github\.com/ }).click();
  await expect(page.getByText(/^(Opening|Could not start)/)).toBeVisible();
  const names = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem("girici:history") ?? "[]") as { name: string }[]).map((entry) => entry.name),
  );
  expect(names).toEqual(["github.com", "en.wikipedia.org"]);
});
