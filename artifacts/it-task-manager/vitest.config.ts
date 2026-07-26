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
      // idb-keyval is ESM-only. On Windows, Node's CommonJS loader rejects it
      // with ERR_REQUIRE_ESM when test code imports it through Vite's module
      // graph. Inlining it routes the import through Vite's transform pipeline
      // instead, which produces a CJS-compatible module for the test runner.
      //
      // Note: html-encoding-sniffer@6 / @exodus/bytes have a similar problem
      // but it manifests at the forks-worker startup level (jsdom initializing),
      // before Vite's module system is active. server.deps.inline cannot reach
      // that level. That crash is fixed by the pnpm patch in
      // patches/@exodus__bytes@1.15.1.patch which adds a "require" condition
      // to @exodus/bytes's exports map, routing CJS callers to encoding-lite.cjs.
      inline: ["idb-keyval"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
