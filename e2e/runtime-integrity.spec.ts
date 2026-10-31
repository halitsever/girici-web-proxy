import { expect, openThroughUi, test } from "./support/test.ts";

test("replaces a tampered runtime after the service worker restarts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium can stop service workers on demand");
  await openThroughUi(page, "https://site-a.test/runtime?x=1#h");
  await page.goto("/");
  const name = await page.evaluate(async () => {
    const key = (await caches.keys()).find((k) => k.startsWith("girici:/_g/client."))!;
    const cache = await caches.open(key);
    await cache.put(key.slice("girici:".length), new Response("window.__tampered = 1;"));
    return key;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await page.goto("/~/https/site-a.test/runtime?x=1#h");
  await expect(page.locator("#results")).toContainText('"href":"https://site-a.test/runtime?x=1#h"');
  expect(await page.evaluate(() => (window as { __tampered?: number }).__tampered)).toBeUndefined();
  await page.goto("/");
  expect(
    await page.evaluate(async (key) => (await (await caches.open(key)).match(key.slice(7)))!.text(), name),
  ).not.toContain("__tampered");
});

test("serves the same verified runtime whatever query string asks for it", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/runtime?x=1#h");
  // The proxied page's fetch is rewritten to the site, so ask from the Girici origin itself.
  await page.goto("/");
  // Only the service worker answers without the static handler's cache-control and etag.
  const [plain, withQuery] = await page.evaluate(async () => {
    const key = (await caches.keys()).find((k) => k.startsWith("girici:/_g/client."))!;
    const path = key.slice("girici:".length);
    const read = async (url: string) => {
      const res = await fetch(url);
      return {
        text: await res.text(),
        type: res.headers.get("content-type"),
        cacheControl: res.headers.get("cache-control"),
        etag: res.headers.get("etag"),
      };
    };
    return [await read(path), await read(`${path}?n=abc`)];
  });
  expect(plain.text.length).toBeGreaterThan(1000);
  expect(withQuery).toEqual(plain);
  expect(plain.type).toBe("text/javascript; charset=utf-8");
  expect(plain.cacheControl).toBeNull();
  expect(plain.etag).toBeNull();
});
