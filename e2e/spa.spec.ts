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
  expect(out.timer).toBe("https://site-a.test/exec");
  expect(out.nested).toBe("site-a.test");
  expect(out.evalDirect).toBe("https://site-a.test/exec");
  expect(out.toString).toBe(true);
});

test("keeps classic, module and blob workers inside the proxy", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/worker2");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.classicHref).toBe("https://site-a.test/worker-classic.js");
  expect(out.moduleHref).toBe("https://site-a.test/worker-module.js");
  expect(out.blobApi).toBe("GET");
});
