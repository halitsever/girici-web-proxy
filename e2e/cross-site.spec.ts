import type { FrameLocator, Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

test("refuses another site's popup document but keeps messaging and navigation", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/cross-popup");
  const popup = page.waitForEvent("popup");
  await page.click("#open");
  await (await popup).waitForLoadState();
  await page.click("#check");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    document: "SecurityError",
    storage: "SecurityError",
    closed: false,
    posted: true,
  });
});

test("keeps an embedded site's storage per top site and a same-site frame on its own storage", async ({ page }) => {
  await openThroughUi(page, "https://site-b.test/storage?set=b");
  await page.goto("/~/https/www.site-a.test/storage?set=w");
  await page.goto("/~/https/site-a.test/embed-storage");
  await expect(page.frameLocator("#b").locator("#value")).toHaveText("");
  await expect(page.frameLocator("#www").locator("#value")).toHaveText("w");
});

test("keeps the sender of a cross-site frame's messages when the page touched it first", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/pm-touch");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    readyOrigin: "https://site-b.test",
    readyFromChild: true,
    pingFromParent: true,
    pingOrigin: "https://site-a.test",
  });
});

test("refuses a cross-site frame's static top access", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/top-host");
  await expect(page.locator("#top")).toHaveText("SecurityError");
});

test("hides another site's frame, sender and History behind the browser's own walls", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/xs-hooks");
  await expect(page.locator("#results")).not.toBeEmpty();
  const results = JSON.parse((await page.locator("#results").textContent()) ?? "{}") as Record<string, unknown>;
  expect(results).toMatchObject({
    contentDocument: true,
    sourceDocument: "SecurityError",
    frameElement: true,
    history: "SecurityError",
  });
  // Firefox has no getSVGDocument on frames.
  expect([true, "absent"]).toContain(results.svgDocument);
});

for (const [name, button] of [
  ["window.open", "#open"],
  ["document.open with three arguments", "#doc-open"],
] as const) {
  test(`restricts another site's popup opened through ${name}, and the popup its opener`, async ({ page }) => {
    await openThroughUi(page, "https://site-a.test/xs-opener");
    const popupEvent = page.waitForEvent("popup");
    await page.click(button);
    const popup = await popupEvent;
    // Another site's page reaches the popup through a blank first page.
    await popup.waitForURL(/\/~\/https\/site-b\.test\/xs-opened/);
    await expect(popup.locator("#results")).not.toBeEmpty();
    expect(JSON.parse((await popup.locator("#results").textContent()) ?? "{}")).toEqual({
      runtime: true,
      openerDocument: "SecurityError",
      openerClosed: false,
    });
    await page.click("#check");
    await expect(page.locator("#results")).not.toBeEmpty();
    expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
      document: "SecurityError",
      closed: false,
    });
  });
}

test("shows a storage change only to windows of the site that made it", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/storage-events");
  const other = await context.newPage();
  await other.goto("/~/https/site-b.test/storage-events");
  const writer = await context.newPage();
  await writer.goto("/~/https/site-a.test/storage?set=v1");
  await expect(page.locator("#events")).toHaveText('["k","v1",true]');
  // A storage event reaches every window of the origin in the same task, so the other site's has had its chance.
  await writer.goto("/~/https/site-a.test/storage?set=v2");
  await expect(page.locator("#events")).toContainText('["k","v2",true]');
  await expect(other.locator("#events")).toHaveText("");
});

test("runs no code another site sends to its top through javascript: URLs", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  // WebKit holds the load event while the frame's javascript: navigations are pending, so this waits for less.
  await page.goto("/~/https/site-a.test/xs-js-host", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({ pwned: 0 });
});

for (const [name, open] of [
  ["a blank popup", ["#blank"]],
  ["a popup of the same site", ["#same", "#hold"]],
] as const) {
  test(`takes ${name} away from its opener once the opener sends it to another site`, async ({ page }) => {
    await openThroughUi(page, "https://site-a.test/xs-held");
    const popupEvent = page.waitForEvent("popup");
    await page.click(open[0]);
    const popup = await popupEvent;
    await popup.waitForLoadState();
    if (open[1]) await page.click(open[1]);
    await page.click("#away");
    await popup.waitForURL(/\/~\/https\/site-b\.test\/xs-opened/);
    await expect(popup.locator("#results")).not.toBeEmpty();
    await page.click("#check");
    await expect(page.locator("#results")).not.toBeEmpty();
    expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
      before: "open",
      document: "SecurityError",
      global: "SecurityError",
      closed: false,
    });
  });
}

// The page wraps its own built-ins, then opens or embeds the victim; "seed" writes from a second tab of the victim's
// site. An embedded victim is third-party, so only its writes reach the cookie code.
const COOKIE_PATHS = [
  ["popup", "read"],
  ["popup", "write"],
  ["popup", "sync"],
  ["popup", "listen"],
  ["popup", "store"],
  ["frame", "write"],
  ["frame", "store"],
] as const;
for (const [via, scenario] of COOKIE_PATHS) {
  const made = via === "popup" ? "opens" : "embeds";
  test(`keeps the cookies of a site a page ${made} out of that page's own built-ins: ${scenario}`, async ({
    page,
    context,
  }) => {
    await openThroughUi(page, `https://site-a.test/xs-cookie-spy?do=${scenario}`);
    const seed = async () => {
      const other = await context.newPage();
      await other.goto("/~/https/site-b.test/xs-cookie-victim?do=seed");
      await expect(other.locator("#results")).not.toBeEmpty();
    };
    if (scenario === "read") await seed();
    let victim: Page | FrameLocator;
    if (via === "popup") {
      const popupEvent = page.waitForEvent("popup");
      await page.click("#open");
      const popup = await popupEvent;
      await popup.waitForURL(/\/~\/https\/site-b\.test\/xs-cookie-victim/);
      victim = popup;
    } else {
      await page.click("#frame");
      victim = page.frameLocator("#victim");
    }
    await expect(victim.locator("#results")).not.toBeEmpty();
    if (scenario === "listen") {
      await seed();
      // The worker's message reaches the victim a moment after the other tab's write lands.
      await page.waitForTimeout(500);
    }
    const results = JSON.parse((await victim.locator("#results").textContent()) ?? "{}") as { store?: unknown };
    const stored = via === "popup" ? [true, true, true, true] : [false, false, false, false];
    if (scenario === "store") expect([stored, "absent"]).toContainEqual(results.store);
    await page.click("#check");
    await expect(page.locator("#results")).not.toBeEmpty();
    expect(JSON.parse((await page.locator("#results").textContent()) ?? "null")).toEqual([]);
    if (via === "frame" || results.store === "absent") return;
    await victim.locator("#read").click();
    await expect(victim.locator("#cookie")).toContainText("xsl_");
  });
}
