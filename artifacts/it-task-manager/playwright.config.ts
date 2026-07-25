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
    // ── Touch-drag tests (existing) ──────────────────────────────────────────
    {
      name: "chromium-touch",
      use: {
        ...devices["Pixel 5"],
        // Ensure the browser is launched with touch support (devices["Pixel 5"]
        // already sets hasTouch:true but we make it explicit here).
        hasTouch: true,
      },
      // Only run the touch-specific spec on this project.
      testMatch: "**/touch-drag-tree.spec.ts",
    },

    // ── Pointer-drag tests (drop-zone visibility, Chromium + Firefox) ────────
    //
    // The drag-drop-zone-visibility spec dispatches HTML DragEvents via
    // page.evaluate so it does not require touch support.  Running it on both
    // engines ensures the deferred-dragState-clear fix holds in each.
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: false,
      },
      testMatch: "**/drag-drop-zone-visibility.spec.ts",
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        hasTouch: false,
      },
      testMatch: "**/drag-drop-zone-visibility.spec.ts",
    },
  ],
  // Do NOT use webServer here: the dev server is already managed by the
  // artifacts/it-task-manager workflow.  Playwright just connects to it.
});
