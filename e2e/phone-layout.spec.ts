import { expect, test } from "./support/test.ts";

test.use({ viewport: { width: 390, height: 844 } });

test("fits Settings' buttons and history names on a phone", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const names = ["en.wikipedia.org", "news.ycombinator.com"];
    localStorage.setItem("girici:history", JSON.stringify(names.map((name) => ({ name, t: Date.now() }))));
  });
  await page.goto("/settings");
  await expect(page.getByText("news.ycombinator.com")).toBeVisible();
  const overflows = (selector: string) =>
    page
      .locator(selector)
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
          .map((element) => element.textContent?.trim()),
      );
  expect(await overflows("button:text-is('Clear all')")).toEqual([]);
  for (const name of ["en.wikipedia.org", "news.ycombinator.com"]) {
    expect(await overflows(`:text-is('${name}')`), name).toEqual([]);
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("leaves out the keyboard hints", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "only Chromium emulates a coarse pointer");
    await page.goto("/");
    await expect(page.getByLabel("URL or search")).toBeVisible();
    await expect(page.getByText("↑↓ navigate")).toBeHidden();
  });
});
