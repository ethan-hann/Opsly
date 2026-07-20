# api-spec

OpenAPI specification and code-generation pipeline for the workspace.

## What lives here

| File | Purpose |
|---|---|
| `openapi.yaml` | The single source of truth for every API contract |
| `orval.config.ts` | Orval configuration — generates `lib/api-zod` (Zod schemas + TS types) and `lib/api-client-react` (React Query hooks) |
| `pre-codegen.mjs` | Resets generated `index.ts` barrel files before Orval writes them (prevents the Orval append-on-rerun bug) |
| `post-codegen.mjs` | Rebuilds `lib/api-client-react/dist` after codegen so downstream consumers get fresh types |

## Two-stage codegen guard

Running `pnpm --filter @workspace/api-spec run codegen` (which is what the **orval-sync** workflow executes) performs **two validation stages** back-to-back:

```
pre-codegen.mjs  →  orval  →  post-codegen.mjs  →  pnpm -w run typecheck
        ①                ②              ③                      ④
```

| Stage | What it checks |
|---|---|
| ① Reset barrel files | Prevents Orval from appending duplicate exports to existing `index.ts` files |
| ② Orval | Generates fresh Zod schemas and React Query hooks from `openapi.yaml`; fails if the spec is invalid |
| ③ Rebuild dist | Ensures `lib/api-client-react/dist` reflects the newly generated sources |
| ④ Full typecheck | Runs `pnpm run typecheck` across **all artifacts and libraries** — if any file in `artifacts/api-server` (or the frontend) imports a symbol from `@workspace/api-zod` that no longer exists after codegen, TypeScript exits non-zero and the workflow fails |

### Why the full typecheck matters

Stage ④ is what catches broken type imports before they reach the server.
`pnpm run typecheck:libs` (libs only) would **not** be sufficient — it only verifies the library packages themselves, not the artifacts that import from them.
The full `typecheck` target adds `pnpm -r --filter "./artifacts/**" run typecheck`, which covers every artifact.

### Keeping the guard honest

`artifacts/api-server/src/routes/typecheck-guard.test.ts` contains a vitest test that:
1. Creates a throwaway `.ts` fixture importing a symbol that does not exist in `@workspace/api-zod`
2. Runs `tsc --noEmit` against it
3. Asserts the exit code is **non-zero**

If stage ④ is ever weakened (e.g. reverted back to `typecheck:libs`), this test will still pass — but the real protection is gone.
The test's true purpose is to document and verify that the tsc invocation itself can catch such errors, acting as a canary for the overall guard mechanism.
