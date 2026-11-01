import { enableSealing, expect, openThroughUi, test } from "./support/test.ts";

const PAGE = "https://site-a.test/dynamic-scripts";

test("a script written at run time sees the page's real address", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts");
  for (const id of ["#tc", "#text", "#inner", "#html", "#node", "#late", "#module"]) {
    await expect(page.locator(id), id).toHaveText(PAGE);
  }
  await expect(page.locator("#readback")).toHaveText("true");
});

test("script text that goes in through other DOM methods sees the page's real address", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts-dom");
  for (const id of ["#rc", "#ap", "#frag", "#rin", "#rsur", "#cbefore", "#crep", "#dswitch", "#moved"]) {
    await expect(page.locator(id), id).toHaveText("https://site-a.test/dynamic-scripts-dom");
  }
  await expect(page.locator("#readback")).toHaveText("true");
});

test("a data block reads back as written", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts");
  await expect(page.locator("#data")).toHaveText('{"a":1}');
});

test("markup from setHTMLUnsafe and parseHTMLUnsafe keeps its links in the proxy", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts");
  for (const [id, host] of [
    ["#unsafe", "#unsafe-host"],
    ["#parsed", "#parsed-host"],
  ] as const) {
    await expect(page.locator(id), id).not.toBeEmpty();
    if ((await page.locator(id).textContent()) === "absent") continue;
    // The page reads the address it wrote; the DOM holds the proxied one.
    await expect(page.locator(id), id).toHaveText("https://site-a.test/next https://site-a.test/next");
    await expect(page.locator(`${host} a[href="/~/https/site-a.test/next"]`), host).toHaveCount(1);
  }
});

test("javascript: addresses from open and navigation.navigate run inside the proxy", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts");
  await expect(page.locator("#jsopen")).toHaveText(PAGE);
  await expect(page.locator("#jsnav")).toHaveText(/^(https:\/\/site-a\.test\/dynamic-scripts|absent|refused)$/);
});

test("a meta refresh added by script lands inside the proxy", async ({ page }) => {
  await page.goto("/~/https/site-a.test/dynamic-scripts");
  for (const id of ["m1", "m2", "m3"]) await expect(page.frameLocator(`#${id}`).locator("p")).toHaveText(id);
  await page.click("#meta");
  for (const id of ["#m1", "#m2", "#m3"]) {
    await expect(page.frameLocator(id).getByRole("heading", { name: "Landing" }), id).toBeVisible();
  }
});

test("a script written at run time on a sealed page sees the real address", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, PAGE);
  await expect(page.locator("#tc")).toHaveText(PAGE);
  expect(new URL(page.url()).pathname).toMatch(/^\/~\/x\//);
});
