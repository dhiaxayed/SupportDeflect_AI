/**
 * @file Browser integration-test orchestration for the real frontend and an isolated seeded
 * API. Start the fixture backend/client host and Vite, then run journeys serially because they
 * intentionally modify shared fixture organizations. Fixture credentials are synthetic;
 * screenshots and output belong to disposable test artifacts.
 */

import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Fixture credentials are confined to a newly-created test database on each run.
process.env.E2E_ADMIN_PASSWORD ||= "Fixture-only-administration-123!";
process.env.E2E_API_URL ||= "http://127.0.0.1:8020/api/v1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: "./test-results",
  reporter: "list",
  webServer: [
    {
      command: '"' + process.execPath + '" e2e/start-api.mjs',
      url: "http://127.0.0.1:8020/healthz/db",
      timeout: 120000,
      reuseExistingServer: false,
    },
    {
      command:
        '"' +
        process.execPath +
        '" "' +
        resolve("node_modules/vite/bin/vite.js") +
        '" --host 127.0.0.1 --port 5175 --strictPort',
      url: "http://127.0.0.1:5175/login",
      env: { DEV_API_URL: "http://127.0.0.1:8020" },
      timeout: 120000,
      reuseExistingServer: false,
    },
  ],
  use: {
    reducedMotion: "reduce",
    actionTimeout: 15000,
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5175",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "off",
    launchOptions: process.env.E2E_BROWSER_PATH
      ? { executablePath: process.env.E2E_BROWSER_PATH }
      : {},
  },
});
