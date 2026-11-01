import { expect, METRICS_TOKEN, openThroughUi, test } from "./support/test.ts";

test("metrics need the token and name no site", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "no browser involved");
  await openThroughUi(page, "https://site-a.test/");
  await expect(page.locator("#title")).toHaveText("Site A");

  expect((await page.request.get("/metrics")).status()).toBe(401);
  const res = await page.request.get("/metrics", { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toMatch(/girici_relay_requests_total\{kind="http",code="ok"\} [1-9]/);
  expect(text).not.toContain("site-a");
});

test("a proxied page cannot reach the metrics", async ({ page }) => {
  await openThroughUi(page, `https://site-a.test/metrics-probe?proxy=http://127.0.0.1:41000&token=${METRICS_TOKEN}`);
  await expect(page.locator("#result")).toHaveText("404 not found");
  const res = await page.goto("/metrics");
  expect(res?.status()).toBe(403);
});
