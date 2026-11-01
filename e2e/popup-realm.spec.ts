import { expect, openThroughUi, test } from "./support/test.ts";

// Every way the opener can hold a window before another site's first page arrives in it. "existing" sends a window
// that already shows a page of the opener's site, so the victim's page is its second history entry.
const PATHS = [
  ["open", "open(url)", "", 1],
  ["blank", 'open(url, "_blank")', "", 1],
  ["named", "open(url, name)", "xsr-named", 1],
  ["doc-open", "document.open(url, name, features)", "xsr-doc", 1],
  ["existing", "open(url, name) on a window showing the opener's site", "xsr-existing", 2],
  ["pending", "open(url, name) on a window still loading the opener's site", "xsr-pending", 1],
  ["link", 'open("", name) and a link with that target', "xsr-link", 1],
  ["form", 'open("", name) and a form with that target', "xsr-form", 1],
  ["form-opened", "a form aimed at a window opened for the opener's site", "xsr-opened", 1],
  ["redirect", "open(url) of the opener's site that redirects to another", "", 1],
  ["away", "open() and a location write", "", 1],
  ["noopener", 'open(url, "_blank", "noopener")', "", 1],
] as const;

for (const [via, how, name, length] of PATHS) {
  test(`gives another site's page its own realm in a window reached through ${how}`, async ({ page }) => {
    await openThroughUi(page, `https://site-a.test/xs-realm?via=${via}`);
    const popupEvent = page.waitForEvent("popup");
    await page.click("#go");
    const popup = await popupEvent;
    await popup.waitForURL(/\/~\/https\/site-b\.test\/xs-realm-victim/);
    await expect(popup.locator("#results")).not.toBeEmpty();
    const victim = JSON.parse((await popup.locator("#results").textContent()) ?? "{}") as Record<string, unknown>;
    const opened = via !== "noopener";
    expect(victim).toEqual({
      via,
      foreign: 0,
      sample: [],
      compiled: [],
      history: length,
      referrer: "https://site-a.test/",
      name,
      opener: opened,
      openerDocument: opened ? "SecurityError" : "none",
      pong: opened ? "https://site-a.test" : null,
    });
    await page.click("#check");
    await expect(page.locator("#results")).not.toBeEmpty();
    const opener = JSON.parse((await page.locator("#results").textContent()) ?? "{}") as Record<string, unknown>;
    expect(opener.spy).toEqual([]);
    expect(opener.messages).toEqual(opened ? [{ via, origin: "https://site-b.test", fromHandle: true }] : []);
  });
}

test("rewrites code compiled through the generator and async constructors of a frame the page adopts", async ({
  page,
}) => {
  await openThroughUi(page, "https://site-a.test/xs-realm-exec");
  await expect(page.locator("#results")).not.toBeEmpty();
  const href = "https://site-a.test/xs-realm-exec";
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    generator: href,
    async: href,
    asyncGenerator: href,
  });
});
