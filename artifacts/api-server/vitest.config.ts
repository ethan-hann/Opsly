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
      const absPath = path.resolve(repoRoot, relPath);
      // Prefer the on-disk (working-tree) file when it exists.  This is safe
      // because `vitest run` never runs concurrently with orval-sync, so the
      // disk files are stable.  It also handles rebase scenarios where HEAD
      // predates working-tree api-zod changes that are not yet committed.
      if (fs.existsSync(absPath)) {
        apiZodSnapshot.set(absPath, fs.readFileSync(absPath, "utf8"));
        continue;
      }
      // File is tracked but deleted in the working tree — fall back to the
      // committed content so the load hook can serve a stub.
      try {
        const content = execSync(`git show HEAD:${relPath}`, {
          cwd: repoRoot,
          encoding: "utf8",
        });
        apiZodSnapshot.set(absPath, content);
      } catch {
        // File not at HEAD either — skip; load hook will serve an empty stub.
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
// Absolute path to lib/api-zod/src/ — used to identify api-zod files whose
// importer IS in the snapshot but whose own path is not (e.g. a file that
// existed in HEAD but was removed in the working-tree during a rebase).
const apiZodSrcRoot = path.resolve(repoRoot, "lib/api-zod/src");

const stableApiZod = {
  name: "stable-api-zod",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    // Only handle relative imports from within the api-zod src tree.
    if (!importer || !source.startsWith(".")) return null;
    const importerClean = importer.split("?")[0];
    const dir = path.dirname(importerClean);
    // Try plain, .ts, and /index.ts (handles directory-style imports like
    // './generated/types' → './generated/types/index.ts').
    for (const ext of ["", ".ts", "/index.ts"]) {
      const candidate = path.resolve(dir, source + ext);
      if (apiZodSnapshot.has(candidate)) {
        return candidate; // stable path; load hook will serve the content
      }
    }
    // The importer is a snapshot file but the required .ts module is not in the
    // snapshot (e.g. a file removed during a rebase while HEAD's index.ts still
    // references it).  Claim only concrete .ts paths — never bare directories —
    // so the load hook can serve a stub without breaking Vite's own directory
    // → index.ts resolution for modules we DO have on disk.
    const tsCandidate = path.resolve(dir, source + ".ts");
    if (
      tsCandidate.startsWith(apiZodSrcRoot) &&
      apiZodSnapshot.has(importerClean) &&
      !apiZodSnapshot.has(tsCandidate)
    ) {
      return tsCandidate;
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
    // Stub .ts files claimed by resolveId that are not in the snapshot and not
    // on disk (e.g. a type file removed in this branch while HEAD still exports
    // it).  Guard with endsWith(".ts") so we never stub a directory path.
    if (
      cleanId.startsWith(apiZodSrcRoot) &&
      cleanId.endsWith(".ts") &&
      !fs.existsSync(cleanId)
    ) {
      return { code: "export {};", map: null };
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
    // Exclude live-database integration tests when no DATABASE_URL is set.
    // These suites require a real PostgreSQL connection; they crash at import
    // time (lib/db throws synchronously) before their own describeIf skip
    // logic can run.  The CI environment provides DATABASE_URL; local dev
    // without a DB can still run every other test suite.
    exclude: process.env.DATABASE_URL
      ? []
      : [
          "src/**/*-db.test.ts",
          "src/routes/task-events-index.test.ts",
        ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "cobertura"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/**/types.ts"],
      // Global floor — ratchet upward over time. Set a few points below the
      // current no-DB numbers (lines ~70, branches ~64); CI runs the DB suites
      // too, so it can only score higher. Raise these as coverage grows.
      thresholds: {
        lines: 65,
        statements: 64,
        functions: 62,
        branches: 58,
      },
    },
  },
});
