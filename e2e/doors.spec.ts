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

test("swaps blob URLs in every navigation sink and reads back the page's own URL", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/doors-blob-sinks");
  await page.click("#start");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "null")).toEqual({
    ran: [],
    readBack: { property: true, attr: true, object: true, embed: true, markup: true, link: true },
  });
  // Playwright reads attributes in its own world, so this is the bootstrap the browser loaded, kept for the frame.
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
  expect(state).toBe("live");
});

test("loads a blob frame under the runtime again on reload and on the way back", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/blob-frame");
  const frame = page.frameLocator("#f");
  await expect(frame.locator("#state")).toHaveText(/^object:/);
  const first = await frame.locator("#state").textContent();
  const child = page.frame({ url: /^blob:/ });
  expect(child).not.toBeNull();
  await child!.evaluate(() => location.reload());
  await expect(frame.locator("#state")).toHaveText(/^object:/);
  await expect(frame.locator("#state")).not.toHaveText(first ?? "");
  // Through the parent's hooked setter: code Playwright evaluates in the frame is not rewritten.
  await page.evaluate(() => {
    (document.getElementById("f") as HTMLIFrameElement).src = "https://site-a.test/page2";
  });
  await expect(frame.locator("h1")).toHaveText("Page 2");
  await page.evaluate(() => history.back());
  await expect(frame.locator("#state")).toHaveText(/^object:/);
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

test("loads no blob document a served page or header names", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/served-blobs");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({ ran: [] });
});

test("adopts frames with every hook when the page broke the array iterator", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/iterator-adoption");
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({ stores: 0 });
});

test("keeps a served refresh whose target starts with a quote inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/refresh-quote-host");
  await expect(page.locator("#done")).toHaveText("done", { timeout: 15_000 });
  // The escape guard fails the test if the frame went to site-b.test around the proxy.
  const frame = page.frame({ url: /\/~\/https\/site-a\.test\// });
  expect(frame).not.toBeNull();
});
