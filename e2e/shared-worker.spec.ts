import { expect, isSiteProject, test } from "./support/test.ts";

test("two tabs of one site share one shared worker and another site never joins it", async ({ context }) => {
  const first = await context.newPage();
  await first.goto("/~/https/site-a.test/shared-count");
  await expect(first.locator("#count")).toHaveText("1");
  const second = await context.newPage();
  await second.goto("/~/https/site-a.test/shared-count");
  await expect(second.locator("#count")).toHaveText("2");
  const other = await context.newPage();
  await other.goto("/~/https/site-b.test/shared-count");
  await expect(other.locator("#count")).toHaveText("1");
  await expect(first.locator("#where")).toHaveText("https://site-a.test/shared-count.js");
});

test("a site framed by another site shares its shared worker only under that top site", async ({ context }) => {
  const top = await context.newPage();
  await top.goto("/~/https/site-a.test/shared-count");
  await expect(top.locator("#count")).toHaveText("1");
  const framed = await context.newPage();
  await framed.goto("/~/https/site-b.test/shared-frame");
  await expect(framed.frameLocator("#frame").locator("#count")).toHaveText("1");
  const again = await context.newPage();
  await again.goto("/~/https/site-b.test/shared-frame");
  await expect(again.frameLocator("#frame").locator("#count")).toHaveText("2");
});

test("a shared worker address that no page announced starts no worker", async ({ page }) => {
  test.skip(
    isSiteProject(test.info()),
    "The root runs no service worker, and a site host's addresses name only that site's scripts",
  );
  // A proxied page installs the service worker, which the UI's start page does not.
  await page.goto("/~/https/site-b.test/shared-count");
  await expect(page.locator("#count")).toHaveText("1");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The UI realm is not hooked, so it reaches the browser's own SharedWorker as a page that escaped the hooks would.
  const outcome = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const address =
          "/_g/rpc/shared-worker?s=" +
          encodeURIComponent(`${location.origin}/~/https/site-a.test/shared-count.js`) +
          "&p=" +
          encodeURIComponent("__g|https://site-a.test|") +
          "&t=classic";
        const worker = new SharedWorker(address);
        worker.onerror = () => resolve("error");
        worker.port.onmessage = (event) => resolve(`message:${String(event.data)}`);
        worker.port.postMessage("count");
        setTimeout(() => resolve("timeout"), 10_000);
      }),
  );
  expect(outcome).toBe("error");
});
