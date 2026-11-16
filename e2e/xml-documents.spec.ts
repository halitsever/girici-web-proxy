import { expect, openThroughUi, test } from "./support/test.ts";

const STYLE = "rgb(1, 2, 3)";

test("runs framed SVG and XHTML documents under the runtime", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/xml-docs");
  const reports = async () => JSON.parse((await page.locator("#results").textContent()) || "[]") as unknown[];
  await expect.poll(reports, { timeout: 15_000 }).toEqual([
    { kind: "svg", href: "https://site-a.test/scripted.svg", style: STYLE },
    { kind: "xhtml", href: "https://site-a.test/scripted.xhtml", style: STYLE },
  ]);
});

test("opens a top-level SVG document with its scripts and links through the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/scripted.svg");
  await expect(page.locator("svg")).toHaveAttribute("data-report", /./);
  expect(JSON.parse((await page.locator("svg").getAttribute("data-report")) ?? "{}")).toEqual({
    kind: "svg",
    href: "https://site-a.test/scripted.svg",
    style: STYLE,
  });
  await page.locator("#link text").click();
  await expect(page.locator("h1")).toHaveText("Site B");
});

test("opens a top-level XHTML document with its scripts and links through the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/scripted.xhtml");
  await expect(page.locator("#where")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#where").textContent()) ?? "{}")).toEqual({
    kind: "xhtml",
    href: "https://site-a.test/scripted.xhtml",
    style: STYLE,
  });
  await page.click("#link");
  await expect(page.locator("h1")).toHaveText("Site B");
});
