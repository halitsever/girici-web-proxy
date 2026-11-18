import { expect, isSiteProject, openThroughUi, pastBoot, test } from "./support/test.ts";

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
  await pastBoot(page);
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
  test.skip(
    isSiteProject(test.info()),
    "Another site's frame loads on its own host, where the browser gives it a new window as for any cross-origin frame",
  );
  await openThroughUi(page, "https://site-a.test/reuse");
  await expect(page.locator("#results")).not.toBeEmpty();
  // contentWindow and frames[0] keep a frame headed to another site out of reach; an alias still hands it out.
  expect(JSON.parse((await page.locator("#results").textContent()) ?? "{}")).toEqual({
    cookie: "",
    href: "https://site-b.test/reuse-child",
    reused: true,
    fromChild: true,
    contentWindow: "SecurityError",
    index: "SecurityError",
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

test("keeps the origin private file system apart per site", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit fails OPFS writes with UnknownError, even on a plain page");
  const write = (value: string) =>
    page.evaluate(async (text) => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle("note", { create: true });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
    }, value);
  const read = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
      const note = names.includes("note") ? await (await (await root.getFileHandle("note")).getFile()).text() : null;
      return { rootName: root.name, names, note };
    });
  await openThroughUi(page, "https://site-a.test/idb-store");
  await write("a");
  await page.goto("/~/https/site-b.test/idb-store");
  await pastBoot(page);
  expect(await read()).toEqual({ rootName: "", names: [], note: null });
  await page.goto("/~/https/site-a.test/idb-store");
  expect(await read()).toEqual({ rootName: "", names: ["note"], note: "a" });
});

test("refuses one site's blob URLs to another", async ({ page, context }) => {
  await openThroughUi(page, "https://site-a.test/idb-store");
  const theirs = await page.evaluate(() => URL.createObjectURL(new Blob(["secret"])));
  const other = await context.newPage();
  await other.goto("/~/https/site-b.test/idb-store");
  await pastBoot(other);
  const outcome = await other.evaluate(async (url) => {
    const own = URL.createObjectURL(new Blob(["mine"]));
    const viaFetch = await fetch(url).then(
      (response) => response.text(),
      (error: Error) => error.name,
    );
    const viaXhr = await new Promise<string>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.onload = () => resolve(xhr.responseText);
      xhr.onerror = () => resolve("error");
      xhr.send();
    });
    return { viaFetch, viaXhr, own: await (await fetch(own)).text() };
  }, theirs);
  expect(outcome).toEqual({ viaFetch: "TypeError", viaXhr: "error", own: "mine" });
  expect(await page.evaluate(async (url) => (await fetch(url)).text(), theirs)).toBe("secret");
});
