import { expect, openThroughUi, test } from "./support/test.ts";

test("keeps html written into the dom inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/sinks");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    innerAttr: "https://site-b.test/x",
    innerProp: "https://site-b.test/x",
    innerReadBack: true,
    iadjAttr: "https://cdn.site-a.test/b.png",
    fragAttr: "https://site-b.test/y",
    domAttr: "https://site-b.test/z",
  });
  await expect(page.locator('#host a#inner[href="/~/https/site-b.test/x"]')).toHaveCount(1);
});

test("executes rewritten document.write scripts", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/sinks-write");
  await expect(page).toHaveURL(/\/~\/https\/site-a\.test\/sinks-write/);
  await expect(page.locator("#written")).toHaveText("https://site-a.test/sinks-write");
});

test("keeps eval, Function and string timers inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/exec");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.fn).toBe("https://site-a.test/exec");
  expect(out.ctor).toBe("https://site-a.test/exec");
  expect(out.timer).toBe("https://site-a.test/exec");
  expect(out.nested).toBe("site-a.test");
  expect(out.evalDirect).toBe("https://site-a.test/exec");
  expect(out.toString).toBe(true);
  expect([out.generator, out.async, out.asyncGenerator]).toEqual([
    "https://site-a.test/exec",
    "https://site-a.test/exec",
    "https://site-a.test/exec",
  ]);
});

test("hooked functions report native source to tamper checks", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/native-tostring");
  await expect(page.locator("#result")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#result").textContent()) ?? "{}")).toEqual({
    fetch: true,
    xhrOpen: true,
    xhrSend: true,
    toString: true,
    setTimeout: true,
  });
});

test("shows a worker its real origin", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/worker-origin");
  await expect(page.locator("#result")).toHaveText("https://site-a.test");
});

test("keeps classic, module and blob workers inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/worker2");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.classicHref).toBe("https://site-a.test/worker-classic.js");
  expect(out.moduleHref).toBe("https://site-a.test/worker-module.js");
  expect(out.blobApi).toBe("GET");
});

test("starts workers from a blank frame's constructor", async ({ page, browserName }) => {
  await openThroughUi(page, "https://site-a.test/frame-worker");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.blob).toBe("blob ok");
  // Chromium leaves about:blank frames and their workers outside the service worker, so the script cannot load there.
  if (browserName === "chromium") expect(out.classic).toBe("error");
  else expect(out.classic).toBe("https://site-a.test/worker-classic.js");
});

test("keeps blob worker subresources inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/worker-escape");
  await expect(page.locator("#results")).toHaveText("done");
});

test("proxies Navigation API navigations", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/nav-api");
  await page.click("#go");
  await expect(page).toHaveURL(/\/~\/https\/site-b\.test\//);
});
