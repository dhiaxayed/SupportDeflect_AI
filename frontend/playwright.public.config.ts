/** Public UI can be verified with no backend, account or AI credentials. */
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "landing.spec.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: "./test-results/public",
  reporter: "list",
  webServer: process.env.PUBLIC_TEST_URL
    ? undefined
    : {
        command: `"${process.execPath}" "${resolve("node_modules/vite/bin/vite.js")}" --host 127.0.0.1 --port 5176 --strictPort`,
        url: "http://127.0.0.1:5176",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
  use: {
    baseURL: process.env.PUBLIC_TEST_URL || "http://127.0.0.1:5176",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    launchOptions: process.env.E2E_BROWSER_PATH
      ? { executablePath: process.env.E2E_BROWSER_PATH }
      : {},
  },
});
