---
name: api-zod stale tsbuildinfo
description: When a codegen run produces conflicting names in api-zod generated files, tsc caches a broken dist/index.d.ts in the tsbuildinfo. The dist and tsbuildinfo are gitignored, so fresh validation envs rebuild — but if the tsbuildinfo is stale in the working tree, non-force tsc uses it and emits an empty module.
---

## Rule
After any api-zod codegen that hits a naming conflict and then gets fixed, delete both `lib/api-zod/dist/` and `lib/api-zod/tsconfig.tsbuildinfo` before running `pnpm run typecheck`. This forces a clean rebuild.

**Why:** tsc composite builds cache build validity in `.tsbuildinfo`. If a previous broken build wrote a corrupt tsbuildinfo, subsequent non-force `tsc --build` runs trust it and skip rebuilding, leaving `dist/index.d.ts` as just `//# sourceMappingURL=...` (an empty module). The symptom is widespread TS2306 "File is not a module" errors on every import from `@workspace/api-zod`.

**How to apply:** If you see TS2306 errors pointing at `lib/api-zod/dist/index.d.ts`, run:
```
rm -rf lib/api-zod/dist lib/api-zod/tsconfig.tsbuildinfo
pnpm exec tsc --build lib/api-zod
```
Then re-run `pnpm run typecheck` to verify it resolves.

## Orval naming convention that prevents conflicts
When adding new bulk/batch endpoints to the OpenAPI spec, name the component schemas with a distinct prefix that differs from what orval would auto-generate from the operationId. Example: operationId `bulkUpdateTasks` auto-generates zod schemas `BulkUpdateTasksBody`/`BulkUpdateTasksResponse`; if component schemas are also named that, both api.ts AND types/ export those names → conflict. Use names like `BulkTaskPatchInput`/`BulkTaskPatchResult` instead.
