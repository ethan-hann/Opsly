---
name: vitest orval-sync race condition fix
description: How to prevent orval-sync from corrupting @workspace/api-zod files while concurrent vitest processes read them
---

## The Rule
Never put `@workspace/api-zod` in vitest's `deps.inline`. Instead, use a `load` plugin hook that reads committed file content from git (`git show HEAD:<path>`) and returns it from memory.

## Why
The validation pipeline runs `orval-sync` in parallel with two concurrent `vitest` runs. `orval-sync` begins by running `pre-codegen.mjs`, which immediately writes an empty string to `lib/api-zod/src/index.ts` before regenerating content. This happens within milliseconds — faster than vitest can start its process, so any disk-read snapshot is already corrupted.

When `@workspace/api-zod` is in `deps.inline`, vite-node bundles it with esbuild directly, bypassing Vite's plugin pipeline. That esbuild call reads from disk, where the file is empty/partial → Zod validators become `undefined` → all route handlers throw TypeError → cascade of 500s across all mock-based test suites.

## How to Apply
In `artifacts/api-server/vitest.config.ts`:
- Remove `@workspace/api-zod` from `server.deps.inline` (keep `@workspace/db`)
- Add a plugin with `enforce: "pre"` and a `load` hook that:
  1. At module-eval time, runs `git ls-files lib/api-zod/src/` then `git show HEAD:<file>` for each result
  2. Stores content in a `Map<string, string>` keyed by absolute path
  3. Returns the map content in `load(id)` when `id` is under `lib/api-zod/src/`
- This works because git's object store is not touched by orval; orval only modifies the working tree
- `vi.mock("@workspace/api-zod", factory)` continues to work because removing from `deps.inline` means normal Vite module graph applies

## Why Not Other Approaches
- **Disk snapshot at config-eval time**: pre-codegen.mjs writes before vitest starts, so snapshot captures corrupted content
- **`transform` hook**: `deps.inline` bypasses Vite's plugin pipeline entirely (uses esbuild directly), so transform never fires
- **`resolve.alias` to /tmp bundle**: `vi.mock` registrations and alias resolution order differs; concurrent pretest writes can race
- **`buildSync` in config**: Two concurrent vitest processes both call esbuild.buildSync → one crashes
- **`globalSetup` + snapshot file**: globalSetup PID doesn't match worker PIDs reliably; file path coordination is fragile
