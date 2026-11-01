import { defineConfig, devices } from "@playwright/test";
import { SITES } from "./e2e/support/site-mode.ts";

/** Specs for subdomain mode run only in the `-sites` projects, against the site-mode server. */
const SITE_SPECS = /sites[\w-]*\.spec\.ts$/;
/** Single-origin specs whose behaviour must hold in subdomain mode too. */
const BORROWED_SPECS =
  /(?:^|\/)(?:proxy|navigation|cross-site|isolation|cookies|third-party-cookies|toolbar|runtime|popup-realm|websocket|shared-worker|cookie-writes|dynamic-scripts)\.spec\.ts$/;
const singleOrigin = { testIgnore: [SITE_SPECS, ...(process.env.SMOKE ? [] : [/smoke\//])] };
const siteMode = { testMatch: [SITE_SPECS, BORROWED_SPECS] };

export default defineConfig({
  testDir: "e2e",
  testIgnore: process.env.SMOKE ? [] : ["smoke/**"],
  // The fixture servers and the escape trap are shared, so tests run one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:41000",
    proxy: { server: "http://127.0.0.1:41999", bypass: "127.0.0.1,localhost" },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/fixtures/start.ts",
      url: "http://127.0.0.1:41000/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "node e2e/fixtures/start-fresh.ts",
      url: "http://127.0.0.1:41001/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "chromium", ...singleOrigin, use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", ...singleOrigin, use: { ...devices["Desktop Firefox"] } },
    {
      name: "webkit",
      ...singleOrigin,
      use: { ...devices["Desktop Safari"] },
      /** Linux WebKit sometimes never commits a navigation that switches browsing context groups (WebKit bug 327297). */
      retries: process.env.CI ? 1 : 0,
    },
    { name: "chromium-sites", ...siteMode, use: { ...devices["Desktop Chrome"], baseURL: SITES } },
    { name: "firefox-sites", ...siteMode, use: { ...devices["Desktop Firefox"], baseURL: SITES } },
    {
      name: "webkit-sites",
      ...siteMode,
      use: { ...devices["Desktop Safari"], baseURL: SITES },
      /** WebKit bug 327297, as in the `webkit` project. */
      retries: process.env.CI ? 1 : 0,
    },
  ],
});
