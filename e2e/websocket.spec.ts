import type { Page } from "@playwright/test";
import { expect, openThroughUi, test } from "./support/test.ts";

/** How the fixture server saw the client close the echo socket opened with `id`, or null while it has not. */
async function socketLog(page: Page, id: string): Promise<unknown> {
  const response = await page.request.get(`http://127.0.0.1:41080/socket-log?id=${encodeURIComponent(id)}`, {
    headers: { host: "site-a.test" },
  });
  return response.json();
}

test("a page's socket echoes text and binary", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/ws-echo");
  await expect(page.locator("#text")).toHaveText("hello", { timeout: 15_000 });
  await expect(page.locator("#binary")).toHaveText("1,2,3");
});

test("close codes and reasons travel both ways", async ({ page }) => {
  const id = test.info().testId;
  await openThroughUi(page, `https://site-a.test/ws-close?id=${id}`);
  await expect(page.locator("#state")).toHaveText("open", { timeout: 15_000 });
  await page.click("#client-close");
  await expect.poll(() => socketLog(page, id)).toEqual({ code: 4001, reason: "bye" });

  await page.reload();
  await expect(page.locator("#state")).toHaveText("open", { timeout: 15_000 });
  await page.click("#server-close");
  await expect(page.locator("#closed")).toHaveText("4002 srv");

  // The browser cannot send 1006, so the relay reports a dropped upstream as 1011.
  await page.reload();
  await expect(page.locator("#state")).toHaveText("open", { timeout: 15_000 });
  await page.click("#drop");
  await expect(page.locator("#closed")).toHaveText("1011");
});

test("a worker's socket carries the site's cookies and reconnects after the server closes it", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/ws-worker");
  await expect(page.locator("#worker")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#worker").textContent()) ?? "{}")).toEqual({
    cookie: "cookie:ws=1",
    closed: 4002,
    reconnected: "hello",
  });
});

test("WebRTC and the unrelayed transports stay off in pages, frames and workers", async ({ page }) => {
  await openThroughUi(page, "https://site-a.test/rtc-worker");
  await expect(page.locator("#rtc")).not.toBeEmpty({ timeout: 15_000 });
  expect(JSON.parse((await page.locator("#rtc").textContent()) ?? "{}")).toEqual({
    webTransport: "undefined",
    webSocketStream: "undefined",
    rtc: "undefined",
    page: "undefined",
    frame: "undefined",
  });
});
