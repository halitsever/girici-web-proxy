import { expect, openThroughUi, test } from "./support/test.ts";

test("installs the runtime into blank and srcdoc frames", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/frames");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.blankLocation).toBe("https://site-a.test/frames");
  expect(out.srcdocLinkAttr).toBe("https://site-b.test/x");
  await expect(page.locator("iframe#srcdoc")).toHaveCount(1);
});

test("keeps IndexedDB apart per site", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/idb-store?set=a");
  await expect(page.locator("#value")).toHaveText("a");
  await page.goto("/~/https/site-b.test/idb-store");
  await expect(page.locator("#value")).toHaveText("");
  await page.goto("/~/https/site-a.test/idb-store");
  await expect(page.locator("#value")).toHaveText("a");
});

test("passes postMessage between proxied frames", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/postmessage");
  await expect(page.locator("#got")).toHaveText("hello from https://site-a.test");
});

test("names the real sender and origin of cross-site messages", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/pm-source");
  await expect(page.locator("#results")).not.toBeEmpty();
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    readyOrigin: "https://site-b.test",
    readyFromChild: true,
    pingFromParent: true,
    pingOrigin: "https://site-a.test",
  });
});

test("renews a frame window the page touched before setting its src", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/reuse");
  await expect(page.locator("#results")).not.toBeEmpty();
  // contentWindow keeps a frame headed to another site out of reach; frames[0] still hands it out, the single-origin limit.
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    cookie: "",
    href: "https://site-b.test/reuse-child",
    reused: true,
    fromChild: true,
    contentWindow: "SecurityError",
  });
});

test("keeps cookie writes and top-site answers working in renewed same-site frames", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/reuse-same");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  for (const key of ["told", "asked"]) {
    expect(out[key], key).toMatchObject({ key, reused: true, fromChild: true });
    // The write right before the fetch must already be in the jar, and so must the parent's.
    expect(out[key].echo.split("; "), key).toEqual(expect.arrayContaining(["a=1", `${key}=1`]));
  }
});

test("denies notifications", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/notify");
  await expect(page.locator("#perm")).toHaveText("denied");
});

test("contains fetches from a srcdoc script", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/srcdoc-escape");
  await page.waitForTimeout(1500);
  // The escapeGuard fixture asserts zero requests left the proxy.
});

test("does not double-prefix raw attribute reads", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/raw-attr");
  await expect(page.locator("#raw")).toHaveText("https://site-a.test/api");
  await expect(page.locator("#rawnode")).toHaveText("https://site-a.test/api");
  await expect(page.locator("#fetched")).toHaveText("GET");
});

test("runs no script in documents the proxy does not rewrite", async ({ page, browserName }) => {
  await openThroughUi(page, "https://site-a.test/inert");
  await expect(page.locator("#results")).not.toBeEmpty();
  const out = JSON.parse((await page.locator("#results").textContent()) ?? "{}");
  expect(out.ran).toBe(0);
  // WebKit loads object and embed documents without asking the service worker, so only the four frames are checked there.
  const checked = browserName === "webkit" ? out.readable.slice(0, 4) : out.readable;
  expect(checked.every((value: boolean) => value === false)).toBe(true);
  await page.goto("/~/https/site-a.test/doc.svg");
  await expect(page.locator("svg")).not.toHaveAttribute("data-ran", "1");
});

test("renders an untyped page as HTML and keeps a text document's charset", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/untyped-page");
  await expect(page.locator("#where")).toHaveText("https://site-a.test/untyped-page");
  await page.goto("/~/https/site-a.test/cyrillic.txt");
  await expect(page.locator("body")).toHaveText("Привет");
});

test("rewrites URLs set through Attr nodes", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/attr-node");
  await expect(page.frameLocator("#by-node").locator("h1")).toHaveText("Site B");
  await expect(page.frameLocator("#by-map").locator("h1")).toHaveText("Site B");
});

test("reads a srcdoc Attr node back as written and runs it once", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/attr-node");
  await expect(page.frameLocator("#moved-srcdoc").locator("#doc")).toHaveText("site-a.test");
  expect(JSON.parse((await page.locator("#readback").textContent()) ?? "{}")).toEqual({
    node: true,
    attribute: true,
    property: true,
    markup: true,
  });
});
