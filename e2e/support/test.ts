import { hkdfSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { labelSiteOf } from "../../packages/engine/src/shared/label-site.ts";
import { siteLabel } from "../../packages/engine/src/shared/site-label.ts";
import { GATES_PORT, QUOTA_PORT } from "../fixtures/servers.ts";
import { SITES, SITE_SECRET } from "./site-mode.ts";

export { METRICS_TOKEN } from "../fixtures/servers.ts";
export { PRIVATE_SITES, SITES, SITE_SECRET } from "./site-mode.ts";

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

/** Turns on this browser's "Encrypt page addresses" switch through the UI's stored settings. */
export async function enableSealing(page: Page): Promise<void> {
  await page.goto("/settings");
  if (isSiteProject(test.info())) {
    // Site hosts read the switch from the settings cookie the root sets.
    const saved = page.waitForResponse((res) => res.url().endsWith("/_g/prefs") && res.status() === 204);
    await page.getByRole("switch", { name: "Encrypt page addresses" }).click();
    await saved;
    return;
  }
  // Settings registers the worker, and WebKit leaves an install a reload cuts short stuck for good.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("girici:settings") ?? "{}") as Record<string, unknown>;
    localStorage.setItem("girici:settings", JSON.stringify({ ...saved, sealAddresses: true }));
  });
  await page.reload();
}

export async function openThroughUi(page: Page, url: string): Promise<void> {
  await page.goto("/");
  const input = page.getByLabel("URL or search");
  await input.fill(url);
  // A typed URL is the first row; Enter submits the command palette and opens it.
  await input.press("Enter");
  await page.waitForURL(/\/~\//);
  // A site host's first visit shows the bootstrap page at the same address before the page itself loads.
  await expect(page.locator("#girici-boot")).toHaveCount(0);
}

export const INSTANCE = "http://127.0.0.1:41002";
/** Public, warning off, browser check on at difficulty 4. */
export const GATES = `http://127.0.0.1:${GATES_PORT}`;
/** Public, warning off, 1 MB a minute per visitor. */
export const QUOTA = `http://127.0.0.1:${QUOTA_PORT}`;

const LABEL_KEY = new Uint8Array(hkdfSync("sha256", SITE_SECRET, "girici", "girici/v1 label", 32));

/** The origin of the host that serves `url`'s site on the subdomain-mode server at `base`. */
export function siteHost(url: string, base: string = SITES): string {
  const root = new URL(base);
  return `${root.protocol}//${siteLabel(LABEL_KEY, labelSiteOf(new URL(url)))}.${root.host}`;
}

export function isSiteProject(info: TestInfo): boolean {
  return info.project.name.endsWith("-sites");
}

export async function signIn(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/_g/login`);
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${base}/`);
}
