import type { APIResponse } from "@playwright/test";
import { expect, QUOTA, test } from "./support/test.ts";

test("a visitor over the bandwidth limit gets a 429 with a wait and the quota page", async ({ page, request }) => {
  let refused: APIResponse | null = null;
  // An earlier browser may have left the bucket negative, so the first request can already be refused.
  for (let attempt = 0; attempt < 4 && !refused; attempt++) {
    const res = await request.get(`${QUOTA}/_g/r/https/site-a.test/bulk?kb=1536`, {
      headers: { "x-girici-relay": "1" },
    });
    if (res.status() === 429) refused = res;
  }
  expect(refused?.headers()["x-girici-error"]).toBe("quota");
  expect(Number(refused?.headers()["retry-after"])).toBeGreaterThan(0);
  await page.goto(`${QUOTA}/~/https/site-a.test/`);
  await expect(page.getByText("used up its data allowance on this Girici server")).toBeVisible();
});
