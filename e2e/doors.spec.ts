import type { BrowserContext } from "@playwright/test";
import { PROBE } from "./fixtures/sites.ts";
import { expect, openThroughUi, test } from "./support/test.ts";

const closed = { jar: false, engineCaches: false, heard: false };

async function startBroadcast(context: BrowserContext) {
  const b = await context.newPage();
  await b.goto("/~/https/site-b.test/broadcast");
  return b;
}

test("keeps workers, nested workers and leaked constructors away from Girici's storage", async ({ page, context }) => {
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
  });
});
