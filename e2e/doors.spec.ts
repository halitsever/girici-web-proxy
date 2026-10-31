import type { BrowserContext } from "@playwright/test";
import { PROBE } from "./fixtures/sites.ts";
import { expect, openThroughUi, test } from "./support/test.ts";

const closed = { jar: false, engineCaches: false, heard: false };

async function startBroadcast(context: BrowserContext) {
  const b = await context.newPage();
  await b.goto("/~/https/site-b.test/broadcast");
  return b;
}

test("keeps workers, nested workers and leaked or tampered constructors away from Girici's storage", async ({
  page,
  context,
}) => {
  await openThroughUi(page, "https://site-a.test/doors-workers");
  await startBroadcast(context);
  const ui = await context.newPage();
  await ui.goto("/");
  // The UI realm is not hooked, so it proves the probe sees the jar, the caches and the channel in this browser.
  expect(await ui.evaluate(`(async () => { ${PROBE}; return girProbe(window); })()`)).toEqual({
    jar: true,
    engineCaches: true,
    heard: true,
  });
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    worker: closed,
    nested: closed,
    leakedWorker: closed,
    leakedChannel: false,
    trapWorker: closed,
    callWorker: closed,
    partsWorker: closed,
  });
});

test("gives every new same-origin window the runtime before page code can reach it", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/doors-frames");
  await startBroadcast(context);
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 20_000 });
  const { hooked, loaded, pip, frameProbe, popupProbe } = JSON.parse(
    (await page.locator("#results").textContent()) ?? "{}",
  );
  expect(Object.entries(hooked).filter(([, value]) => value !== true)).toEqual([]);
  expect(Object.keys(hooked)).toHaveLength(37);
  // Object and embed loads skip the service worker and get the server's inert answer. What remains is no window, a
  // sandboxed one, or the blank window a failed object keeps, which must be hooked.
  for (const state of Object.values(loaded)) expect(["none", "cross-origin", true]).toContain(state);
  // Headless browsers refuse a Picture-in-Picture window; where one opens, it must be hooked.
  expect([true, "unavailable"]).toContain(pip);
  expect(frameProbe).toEqual(closed);
  expect(popupProbe).toEqual(closed);
});

test("keeps navigations in the proxy when page code replaces built-in methods", async ({ page }) => {
  const siteB = /\/~\/https\/site-b\.test\/$/;
  await openThroughUi(page, "https://site-a.test/doors-builtins");
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  await expect(await popup).toHaveURL(siteB);
  await page.click("#frame-src");
  await expect
    .poll(() => page.frames().map((frame) => frame.url()))
    .toContainEqual(expect.stringMatching(/\/~\/https\/site-b\.test\/frame$/));
  await page.click("#link");
  await expect(page).toHaveURL(siteB);
  await page.goto("/~/https/site-a.test/doors-builtins");
  await page.click("#assign");
  await expect(page).toHaveURL(siteB);
});

test("runs srcdoc documents under the runtime from their first script", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/doors-srcdoc");
  await startBroadcast(context);
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 20_000 });
  const results = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  const base = "https://cdn.site-a.test/d/";
  expect(results).toEqual({
    parsed: { hooked: true, base, probe: closed },
    property: { hooked: true, base, probe: closed },
    attribute: { hooked: true, base, probe: closed },
  });
  expect(JSON.parse((await page.locator("#readback").textContent()) ?? "{}")).toEqual({
    property: true,
    attribute: true,
    markup: true,
  });
});
