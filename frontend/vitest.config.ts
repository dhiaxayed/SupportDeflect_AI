/**
 * @file Frontend unit/component-test configuration. Use React transforms and the production
 * source alias, run source-tree test files in jsdom, and load the shared cleanup setup so
 * rendered DOM, storage and stubbed globals cannot leak between tests.
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
