import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testIgnore: process.env.SMOKE ? [] : ["smoke/**"],
  // The fixture servers and the escape trap are shared, so tests run one at a time.
  workers: 1,
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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
