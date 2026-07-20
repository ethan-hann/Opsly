---
name: api-zod stale tsbuildinfo
description: When a codegen run produces conflicting names in api-zod generated files, tsc caches a broken dist/index.d.ts in the tsbuildinfo. The dist and tsbuildinfo are gitignored, so fresh validation envs rebuild — but if the tsbuildinfo is stale in the working tree, non-force tsc uses it and emits an empty module.
---

## Stale-cache protection (how it works now)

The `typecheck:libs` step in the codegen script calls `tsc --build --force`, which bypasses `.tsbuildinfo` and always performs a full emit — even when `dist/` was deleted before codegen ran. No tsbuildinfo cleanup is needed in `pre-codegen.mjs`.

**Why:** Deleting `.tsbuildinfo` in `pre-codegen.mjs` (before orval) causes a race condition: the validation system runs `typecheck` and `orval-sync` concurrently. Deleting the tsbuildinfo forces a slow full recompile in the `typecheck` workflow, widening the window where it overlaps with orval's file operations and gets TS6307 errors on just-deleted generated files.

**The orval race (TS6307 root cause):** With `clean: true`, orval deletes `src/generated/` before regenerating. If a concurrent `tsc --build` starts while orval is mid-clean, tsc gets TS6307 for the absent files. Fix: orval is now configured with `clean: false` in `lib/api-spec/orval.config.ts` — files are overwritten in-place, never deleted, eliminating the window.

**Note:** `clean: false` means deleted API types accumulate in `src/generated/types/` until codegen writes new content over them. This is acceptable; the index files are reset by `pre-codegen.mjs` on every codegen run.

## Manual recovery (TS2306 "file is not a module" outside codegen)

If you see TS2306 errors after manually editing generated files, run:
```
rm -rf lib/api-zod/dist lib/api-zod/tsconfig.tsbuildinfo
pnpm exec tsc --build lib/api-zod
```
Then re-run `pnpm run typecheck` to verify it resolves.

## Orval naming convention that prevents conflicts

When adding new bulk/batch endpoints to the OpenAPI spec, name the component schemas with a distinct prefix that differs from what orval would auto-generate from the operationId. Example: operationId `bulkUpdateTasks` auto-generates zod schemas `BulkUpdateTasksBody`/`BulkUpdateTasksResponse`; if component schemas are also named that, both api.ts AND types/ export those names → conflict. Use names like `BulkTaskPatchInput`/`BulkTaskPatchResult` instead.
