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
      // with ERR_REQUIRE_ESM. Inlining it through Vite's transform pipeline
      // avoids the native loader entirely and makes the package work in jsdom.
      inline: ["idb-keyval"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
