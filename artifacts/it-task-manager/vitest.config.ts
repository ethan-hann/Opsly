import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Standalone vitest config — does NOT import vite.config.ts so that PORT/BASE_PATH
// env-var guards in the dev-server config don't run during test collection.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Exclude Playwright e2e tests — they run via `pnpm test:e2e`, not vitest.
    exclude: ["e2e/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/test-setup.ts",
        "src/i18n/**",
        "src/main.tsx",
      ],
      // Global floor — ratchet upward over time. Frontend coverage starts low
      // (lots of UI); this floor just prevents regression below today's level.
      // Raise these deliberately as page/component tests are added.
      thresholds: {
        lines: 22,
        statements: 21,
        functions: 13,
        branches: 17,
      },
    },
  },
  server: {
    deps: {
      // These packages are ESM-only. On Windows, vitest's jsdom environment
      // loads them via Node's CommonJS loader and gets ERR_REQUIRE_ESM.
      // Inlining them routes the import through Vite's transform pipeline
      // instead, which produces a CJS-compatible module for the test runner.
      //
      // idb-keyval     — imported directly by app code
      inline: ["idb-keyval"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
