/**
 * Playwright configuration for end-to-end touch-drag tests.
 *
 * Targets the running dev server (managed by the artifacts/it-task-manager
 * workflow).  The PORT environment variable must be set (same value as the
 * workflow uses).
 *
 * Run with:
 *   pnpm --filter @workspace/it-task-manager test:e2e
 */

import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "5173";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "line",
  timeout: 30_000,
  use: {
    baseURL,
    // Touch events require a device that reports hasTouch.
    hasTouch: true,
    trace: "retain-on-failure",
    // Pixel 5 viewport so the tree is rendered at a realistic mobile size.
    viewport: { width: 393, height: 851 },
  },
  projects: [
    {
      name: "chromium-touch",
      use: {
        ...devices["Pixel 5"],
        // Ensure the browser is launched with touch support (devices["Pixel 5"]
        // already sets hasTouch:true but we make it explicit here).
        hasTouch: true,
      },
    },
  ],
  // Do NOT use webServer here: the dev server is already managed by the
  // artifacts/it-task-manager workflow.  Playwright just connects to it.
});
