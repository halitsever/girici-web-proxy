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
  const input = page.getByLabel("URL or search");
  await input.fill(url);
  // A typed URL is the first row; Enter submits the command palette and opens it.
  await input.press("Enter");
  await page.waitForURL(/\/~\//);
}

export const INSTANCE = "http://127.0.0.1:41002";

export async function signIn(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/_g/login`);
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${base}/`);
}
