import { expect, test } from "./support/test.ts";

test("fills the address box with a link shared from another app, without opening it", async ({ page }) => {
  await page.goto("/?title=A&text=Read%20this%20https%3A%2F%2Fexample.com%2Fa");
  await expect(page.getByLabel("URL or search")).toHaveValue("https://example.com/a");
  const { pathname, search } = new URL(page.url());
  expect({ pathname, search }).toEqual({ pathname: "/", search: "" });
});

test("fills the address box from a search shortcut", async ({ page }) => {
  await page.goto("/?q=bosphorus%20bridge");
  await expect(page.getByLabel("URL or search")).toHaveValue("bosphorus bridge");
});
