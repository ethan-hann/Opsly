/**
 * Verifies that the full-workspace typecheck catches a broken API type import
 * before it can reach the running server.
 *
 * The orval-sync workflow runs `pnpm run typecheck` as its final step so that
 * any import of a non-existent symbol from @workspace/api-zod causes a CI
 * failure immediately after codegen.  This test guards that guard: if someone
 * reverts the final step back to `typecheck:libs` (which only covers libs, not
 * artifacts), the test below will catch it before the regression ships.
 *
 * Strategy:
 *   1. Write a throwaway .ts fixture that imports a symbol that does not exist.
 *   2. Point a minimal tsconfig at it, resolving @workspace/api-zod through the
 *      built dist so no live codegen run is needed.
 *   3. Run `tsc --noEmit` and assert the exit code is non-zero.
 *   4. Run the same check with a valid import to confirm there are no false
 *      positives (guard should pass clean code through).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// pnpm sets cwd to the package root (artifacts/api-server) when running tests.
// Two levels up is the monorepo root.
const repoRoot = resolve(process.cwd(), "../..");
const tscBin   = join(repoRoot, "node_modules/.bin/tsc");

/** Write a minimal tsconfig that resolves @workspace/api-zod via the built dist. */
function writeTsconfig(dir: string): void {
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        noEmit: true,
        // skipLibCheck suppresses errors inside .d.ts files but NOT errors in
        // the user's .ts files (TS2305 "has no exported member" is raised on
        // the importing .ts file, so the guard still fires).
        skipLibCheck: true,
        // baseUrl (absolute) + paths lets tsc find @workspace/api-zod without
        // needing node_modules or a project reference.
        baseUrl: repoRoot,
        paths: {
          "@workspace/api-zod": [join("lib", "api-zod", "dist", "index")],
        },
      },
      files: ["fixture.ts"],
    }),
  );
}

// tsc can take several seconds even on a small fixture; give it ample headroom.
const TSC_TIMEOUT_MS = 20_000;

describe("typecheck guard — broken API import is caught by tsc", () => {
  it("tsc exits non-zero when a file imports a symbol that does not exist in @workspace/api-zod", { timeout: TSC_TIMEOUT_MS }, () => {
    const dir = join(tmpdir(), `typecheck-guard-bad-${process.pid}`);
    mkdirSync(dir, { recursive: true });

    try {
      writeFileSync(
        join(dir, "fixture.ts"),
        // Use a deliberately mangled name so it can never accidentally become real.
        `import { _NonExistentSymbol_ThatShouldNeverExist } from "@workspace/api-zod";\n` +
        `console.log(_NonExistentSymbol_ThatShouldNeverExist);\n`,
      );
      writeTsconfig(dir);

      const result = spawnSync(tscBin, ["--noEmit", "--project", join(dir, "tsconfig.json")], {
        encoding: "utf8",
      });

      // The guard must fire: tsc must exit with a non-zero status.
      expect(
        result.status,
        `tsc should have failed on the bad import but exited 0.\nstdout: ${result.stdout}`,
      ).not.toBe(0);

      // The output should name the offending symbol so the developer knows what to fix.
      expect(result.stdout).toMatch(/_NonExistentSymbol_ThatShouldNeverExist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tsc exits zero when a file imports using a namespace wildcard (no false positives)", { timeout: TSC_TIMEOUT_MS }, () => {
    const dir = join(tmpdir(), `typecheck-guard-good-${process.pid}`);
    mkdirSync(dir, { recursive: true });

    try {
      writeFileSync(
        join(dir, "fixture.ts"),
        // Wildcard import is always valid as long as the module resolves.
        `import * as apiZod from "@workspace/api-zod";\nexport type _check = typeof apiZod;\n`,
      );
      writeTsconfig(dir);

      const result = spawnSync(tscBin, ["--noEmit", "--project", join(dir, "tsconfig.json")], {
        encoding: "utf8",
      });

      // No false positives: clean code must pass.
      expect(
        result.status,
        `tsc should have passed on the wildcard import but exited ${result.status}.\nstdout: ${result.stdout}`,
      ).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
