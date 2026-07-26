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
