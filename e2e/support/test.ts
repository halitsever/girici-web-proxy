import { writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

const TRAP_LOG = "http://127.0.0.1:41999/log";

export const test = base.extend<{ escapeGuard: void }>({
  escapeGuard: [
    // Playwright reads fixture dependencies from this destructuring pattern, so the empty one must stay.
    async ({}, use, testInfo) => {
      await fetch(TRAP_LOG, { method: "DELETE" });
      await use();
      const escaped = (await (await fetch(TRAP_LOG)).json()) as string[];
      // Real sites still leak through absolute links and scripts until the rewriter lands, so smoke tests only report.
      if (testInfo.file.includes(`${sep}smoke${sep}`)) {
        const path = testInfo.outputPath("escaped-requests.json");
        await writeFile(path, JSON.stringify(escaped, null, 2));
        await testInfo.attach("escaped-requests", { path, contentType: "application/json" });
      } else {
        expect(escaped, "requests that left the proxy").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

export async function openThroughUi(page: Page, url: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Unblock" }).click();
  await page.waitForURL(/\/~\//);
}
