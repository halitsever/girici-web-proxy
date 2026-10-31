import type { Page } from "@playwright/test";
import { enableSealing, expect, openThroughUi, test } from "./support/test.ts";

const SEALED = /\/~\/x\/[\w-]+\.[\w-]+$/;
const label = (url: string) => new URL(url).pathname.split("/")[3]!.split(".")[0];

/** Evaluated code skips the runtime's rewriting, so the expression goes through the page's hooked Function instead. */
const pageSees = (page: Page, expression: string) =>
  page.evaluate((code) => new Function(`return ${code}`)() as string, expression);

test("a page opened through the UI gets a sealed address and loads its relative resources", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/page");
  expect(page.url()).toMatch(SEALED);
  expect(page.url()).not.toContain("site-a");
  await expect
    .poll(() => page.locator("#rel").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator("body")).toHaveAttribute("data-mod", "1");
});

test("a reload and a cross-site link keep sealed addresses", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/page");
  const first = page.url();
  await page.reload();
  expect(page.url()).toBe(first);
  await page.getByRole("link", { name: "site-b" }).click();
  await expect(page.getByRole("heading", { name: "Target" })).toBeVisible();
  expect(page.url()).toMatch(SEALED);
  expect(label(page.url())).not.toBe(label(first));
});

test("a sealed address does not open in another browser", async ({ page, browser }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/page");
  const other = await browser.newContext();
  try {
    const stranger = await other.newPage();
    await stranger.goto(page.url());
    await expect(stranger.getByText("sealed in another browser")).toBeVisible();
  } finally {
    await other.close();
  }
});

test("a sealed page cannot reach the address key's database", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/page");
  const seen = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("__girici_keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...db.objectStoreNames];
    db.close();
    return { names, stores };
  });
  expect(seen.names).not.toContain("__girici_keys");
  expect(seen.stores).toEqual([]);
});

test("a sealed page sees its real address through pushState, reload and back", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/spa");
  const first = page.url();
  expect(first).toMatch(SEALED);
  await page.getByRole("button", { name: "Push" }).click();
  await expect(page.locator("#href")).toHaveText("https://site-a.test/sealed/next?a=1");
  expect(page.url()).toMatch(SEALED);
  expect(page.url()).not.toBe(first);
  await page.reload();
  await expect(page.locator("#href")).toHaveText("https://site-a.test/sealed/next?a=1");
  await page.goBack();
  await expect.poll(() => page.url()).toBe(first);
  await expect.poll(() => pageSees(page, "location.pathname")).toBe("/sealed/spa");
});

test("hash links scroll and query links reseal", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/spa");
  const first = page.url();
  await page.locator("#to-bottom").click();
  await expect.poll(() => page.url()).toBe(`${first}#bottom`);
  expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe("kept");
  await page.locator("#page2").click();
  await expect.poll(() => pageSees(page, "location.search")).toBe("?page=2");
  expect(page.url()).toMatch(SEALED);
  expect(page.url()).not.toBe(first);
  expect(page.url()).not.toContain("?");
});

test("a search form lands on a sealed address with its query", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/spa");
  await page.getByLabel("Search").fill("find me");
  await page.locator("#search-go").click();
  await expect(page.locator("#query")).toHaveText("?q=find+me");
  expect(page.url()).toMatch(SEALED);
  await expect(page.locator("#search")).toHaveText("?q=find+me");
});

test("a same-site frame in a sealed page keeps its cookies", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/spa");
  // The first load sets the cookie while its frame is already on the way, so a reload shows what the frame sends.
  await page.reload();
  await expect(page.frameLocator("#frame").locator("body")).toContainText("sealed=1");
});

test("a popup a sealed page opens lands on a sealed address", async ({ page }) => {
  await enableSealing(page);
  await openThroughUi(page, "https://site-a.test/sealed/spa");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Popup" }).click();
  const popup = await opened;
  await expect(popup.locator("#href")).toHaveText("https://site-a.test/sealed/next");
  expect(popup.url()).toMatch(SEALED);
  await expect(page.locator("#popup")).toHaveText("/sealed/next");
});
