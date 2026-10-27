import type { Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

async function rangeFetch(page: Page, url: string, range: string) {
  return page.evaluate(
    async ([u, r]) => {
      const response = await fetch(u, { headers: { Range: r } });
      const body = await response.arrayBuffer();
      return { status: response.status, contentRange: response.headers.get("content-range"), length: body.byteLength };
    },
    [url, range] as const,
  );
}

test("serves a byte range as 206 with the right bytes", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  const res = await rangeFetch(page, "https://site-a.test/range", "bytes=0-9");
  expect(res.status).toBe(206);
  expect(res.contentRange).toBe("bytes 0-9/10000");
  expect(res.length).toBe(10);
});

test("serves an open-ended range", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  const res = await rangeFetch(page, "https://site-a.test/range", "bytes=9990-");
  expect(res.status).toBe(206);
  expect(res.contentRange).toBe("bytes 9990-9999/10000");
  expect(res.length).toBe(10);
});

test("returns 416 for an unsatisfiable range", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  const res = await rangeFetch(page, "https://site-a.test/range", "bytes=999999-");
  expect(res.status).toBe(416);
  expect(res.contentRange).toBe("bytes */10000");
});

test("plays a proxied video", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/video-page");
  await expect
    .poll(() => page.locator("#v").evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15000 })
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('#v source[src^="/~/https/site-a.test/"]').first()).toHaveCount(1);
});

test("leaves a MediaSource blob url untouched", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/mse");
  await expect(page.locator("#result")).toHaveText(/^blob:/);
});

test("aborts the upstream when a media fetch is cancelled", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/");
  await page.evaluate(async () => {
    const controller = new AbortController();
    const pending = fetch("/~/https/site-a.test/abortable", { signal: controller.signal }).catch(() => {});
    setTimeout(() => controller.abort(), 100);
    await pending;
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await fetch("/~/https/site-a.test/abortable/aborts");
          return ((await r.json()) as { aborts: number }).aborts;
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
});
