import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Race-condition fix for orval-sync vs concurrent vitest processes
//
// Root cause: orval-sync's pre-codegen.mjs immediately writes an empty string
// to lib/api-zod/src/index.ts before generating the real content.  This write
// happens within milliseconds — faster than any in-process snapshot approach
// can defend against, because vitest itself takes ~200 ms to start.
//
// Fix: read committed file content from git (git show HEAD:<path>) instead of
// from disk.  The git object store is not modified by orval-sync, so the
// content is always the stable, correct, pre-orval version.  This works
// because orval-sync is idempotent: the validation pipeline enforces that
// orval produces no diff (`git diff --exit-code`), so committed == generated.
//
// The stableApiZod plugin serves every lib/api-zod/src/ file from this
// git-sourced in-memory snapshot via a `load` hook, preventing Vite from
// ever touching the disk files during a test run.
// ---------------------------------------------------------------------------

const apiZodGitPrefix = "lib/api-zod/src/";

/** Content of every tracked file under lib/api-zod/src/, from git HEAD. */
const apiZodSnapshot = new Map<string, string>();

(function buildSnapshot() {
  try {
    // List all git-tracked files under lib/api-zod/src/
    const listed = execSync("git ls-files lib/api-zod/src/", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    for (const relPath of listed.trim().split("\n").filter(Boolean)) {
      try {
        const content = execSync(`git show HEAD:${relPath}`, {
          cwd: repoRoot,
          encoding: "utf8",
        });
        const absPath = path.resolve(repoRoot, relPath);
        apiZodSnapshot.set(absPath, content);
      } catch {
        // File tracked but not at HEAD (e.g. added but not committed) — skip;
        // the load hook will fall through to disk for this file.
      }
    }
  } catch {
    // git not available or repo not initialised — fall back to empty snapshot;
    // the load hook falls through and Vite reads files from disk as normal.
  }
})();

/**
 * Serves git-HEAD content for every .ts file under lib/api-zod/src/.
 *
 * resolveId: intercepts relative imports whose importer is inside
 *   lib/api-zod/src/ and short-circuits resolution using the snapshot map.
 *   This prevents Vite from hitting the disk for a module that orval may have
 *   temporarily deleted/truncated as part of its write cycle.
 *
 * load: serves the snapshotted content so Vite never reads the disk file.
 *
 * vi.mock("@workspace/api-zod", factory) continues to work: removing api-zod
 * from deps.inline means it goes through the normal Vite module graph that
 * vi.mock hooks into.
 */
const stableApiZod = {
  name: "stable-api-zod",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    // Only handle relative imports — check snapshot membership to confirm the
    // resolved path is an api-zod file we own (no apiZodSrcRoot reference
    // needed; the map only contains api-zod files).
    if (!importer || !source.startsWith(".")) return null;
    const dir = path.dirname(importer.split("?")[0]);
    for (const ext of ["", ".ts"]) {
      const candidate = path.resolve(dir, source + ext);
      if (apiZodSnapshot.has(candidate)) {
        return candidate; // stable path; load hook will serve the content
      }
    }
    return null;
  },
  load(id: string) {
    // Strip Vite's optional ?v=<hash> cache-buster before Map lookup.
    const cleanId = id.split("?")[0];
    const snapshot = apiZodSnapshot.get(cleanId);
    if (snapshot !== undefined) {
      return { code: snapshot, map: null };
    }
    return null;
  },
};

// Serve .yaml files as raw text strings so that `import spec from "*.yaml"`
// returns the YAML string (ready for js-yaml.load) rather than crashing
// vitest's import-analysis step.
const yamlAsString = {
  name: "yaml-as-string",
  transform(_code: string, id: string) {
    if (id.endsWith(".yaml")) {
      const content = fs.readFileSync(id, "utf8");
      return `export default ${JSON.stringify(content)}`;
    }
  },
};

export default defineConfig({
  plugins: [stableApiZod, yamlAsString],
  cacheDir: `/tmp/vitest-cache-api-server-${process.pid}`,
  server: {
    deps: {
      // Bundle @workspace/db inline to avoid ENOENT races on cold starts when
      // multiple workers simultaneously load its many generated TypeScript files.
      // @workspace/api-zod is intentionally excluded: it is handled by the
      // stableApiZod plugin above (git-sourced in-memory snapshot, no disk I/O).
      inline: ["@workspace/db"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
