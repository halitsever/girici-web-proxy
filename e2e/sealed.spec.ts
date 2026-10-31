import { enableSealing, expect, openThroughUi, test } from "./support/test.ts";

const SEALED = /\/~\/x\/[\w-]+\.[\w-]+$/;
const label = (url: string) => new URL(url).pathname.split("/")[3]!.split(".")[0];

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
