import { expect, GATES, test } from "./support/test.ts";

test("a visitor passes the browser check once and lands on the page they asked for", async ({ page }) => {
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  await page.goto(`${GATES}/~/https/site-a.test/`);
  await expect(page.locator("#title")).toHaveText("Site A", { timeout: 20_000 });
  expect(visited.some((url) => url.startsWith(`${GATES}/_g/challenge?next=`))).toBe(true);
  visited.length = 0;
  await page.goto(`${GATES}/~/https/site-b.test/`);
  await expect(page.getByRole("heading", { name: "Site B" })).toBeVisible();
  expect(visited.some((url) => url.includes("/_g/challenge"))).toBe(false);
  const cookie = (await page.context().cookies(GATES)).find((c) => c.name === "girici-visitor");
  expect(cookie?.httpOnly).toBe(true);
});

test("the relay refuses a browser without the visitor cookie", async ({ request }) => {
  const res = await request.get(`${GATES}/_g/r/https/site-a.test/`, { headers: { "x-girici-relay": "1" } });
  expect(res.status()).toBe(403);
  expect(res.headers()["x-girici-error"]).toBe("challenge");
});

test("a tab sent back to the check right after passing stops and explains", async ({ page }) => {
  await page.goto(`${GATES}/~/https/site-a.test/`);
  await expect(page.locator("#title")).toHaveText("Site A", { timeout: 20_000 });
  // As if the relay never got the cookie, for example from the other address of a dual-stack network.
  await page.context().clearCookies();
  await page.goto(`${GATES}/~/https/site-a.test/`);
  await expect(page.getByText("This browser passed the check a moment ago")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
