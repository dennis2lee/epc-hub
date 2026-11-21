import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the local stack: `npm run db:start`, then `npm run test:e2e`.
// The dev server is started automatically when it is not already running.
export default defineConfig({
  testDir: "src/tests/e2e",
  outputDir: "build/playwright",
  reporter: [["list"], ["html", { outputFolder: "build/playwright-report", open: "never" }]],
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    ...devices["Pixel 7"],
    locale: "ko-KR",
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
