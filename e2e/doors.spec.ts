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

test("gives every new same-origin window the runtime before page code can reach it", async ({
  page,
  context,
  browserName,
}) => {
  await openThroughUi(page, "https://site-a.test/doors-frames");
  await startBroadcast(context);
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 20_000 });
  const { hooked, frameProbe, popupProbe } = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  // Object loads skip the service worker everywhere. WebKit loads them as frames, so it gets a window to hook;
  // Chromium and Firefox are refused by the server and keep none.
  expect(hooked.object).toBe(browserName === "webkit" ? true : "none");
  delete hooked.object;
  expect(Object.entries(hooked).filter(([, value]) => value !== true)).toEqual([]);
  expect(Object.keys(hooked)).toHaveLength(29);
  expect(frameProbe).toEqual(closed);
  expect(popupProbe).toEqual(closed);
});

test("runs srcdoc documents under the runtime from their first script", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/doors-srcdoc");
  await startBroadcast(context);
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 20_000 });
  const results = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(results).toEqual({
    parsed: { hooked: true, probe: closed },
    property: { hooked: true, probe: closed },
    attribute: { hooked: true, probe: closed },
  });
});

test("runs HTML blob documents under the runtime and others inert", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/doors-blobs");
  await startBroadcast(context);
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    html: { ran: true, href: "https://site-a.test/doors-blobs", probe: closed },
    svgRan: false,
    untypedRan: false,
    popup: { ran: true, href: "https://site-a.test/doors-blobs", probe: closed },
    svgReadable: false,
  });
  const download = page.waitForEvent("download");
  await page.click("#dl");
  expect((await download).suggestedFilename()).toBe("x.txt");
});

test("swaps blob URLs in every navigation sink and reads back the page's own URL", async ({ page, browserName }) => {
  await openThroughUi(page, "https://site-a.test/doors-blob-sinks");
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "null")).toEqual({
    ran: [],
    readBack: { property: true, attr: true, object: true, embed: true, markup: true, link: true },
  });
  // WebKit keeps a revoked blob URL alive while a document loaded from it is open, even when its creator revokes it.
  if (browserName === "webkit") return;
  // Playwright reads attributes in its own world, so this is the bootstrap the browser loaded, already revoked.
  const boot = (await page.locator("iframe:not([name]):not([id])").first().getAttribute("src")) ?? "";
  expect(boot).toMatch(/^blob:/);
  const state = await page.evaluate(
    (url) =>
      fetch(url).then(
        () => "live",
        () => "revoked",
      ),
    boot,
  );
  expect(state).toBe("revoked");
});

test("opens a blob link from the context menu under the runtime", async ({ page, context, browserName }) => {
  await openThroughUi(page, "https://site-a.test/doors-blob-sinks");
  const link = page.locator("#ctx");
  const original = await link.getAttribute("href");
  await link.click({ button: "right" });
  // The browser's own menu would open whatever the attribute holds now.
  const opened = await link.getAttribute("href");
  expect(opened).not.toBe(original);
  // WebKit opens no blob URL in another page at all (WebKitBlobResource error 1), the original included.
  if (browserName !== "webkit") {
    const tab = await context.newPage();
    await tab.goto(opened ?? "");
    await expect(tab.locator("#opened")).toHaveText("opened");
    expect(await tab.evaluate("typeof __g$")).toBe("object");
    await tab.close();
  }
  await page.keyboard.press("Escape");
  await expect.poll(() => link.getAttribute("href")).toBe(original);
});
