---
name: api-client-react dist rebuild
description: api-client-react resolves types from compiled dist/.d.ts files, not source — schema changes must update both src and dist.
---

# api-client-react dist rebuild

## Rule
When editing generated schema types in `lib/api-client-react/src/generated/api.schemas.ts`, you MUST also edit the corresponding declaration file at `lib/api-client-react/dist/generated/api.schemas.d.ts`. The frontend artifact (`it-task-manager`) resolves types from the **dist** folder, not from source.

**Why:** `lib/api-client-react/package.json` exports from `dist/`, so TypeScript resolves declaration files from `dist/generated/api.schemas.d.ts` at typecheck time. Editing only the source will pass a read of the source file but fail the actual tsc run with "Type 'X' is not assignable to type 'Y'" pointing to the dist .d.ts.

**How to apply:** Any time orval regenerates sources or you manually patch a generated type (e.g., adding `| null` to a field in `TaskUpdate`, `Task`, etc.), apply the same change to both:
- `lib/api-client-react/src/generated/api.schemas.ts` — source of truth
- `lib/api-client-react/dist/generated/api.schemas.d.ts` — what tsc actually reads for the frontend

Also update `lib/api-zod/src/generated/api.ts` for the Zod schema (which the API server uses) and `lib/api-spec/openapi.yaml` (the canonical source) to keep all four in sync.

## Observed instance
Adding `dueDate?: string | null` to `TaskUpdate` for the "clear due date" inline edit feature required edits to all four files above. The typecheck error pointed at `dist/generated/api.schemas.d.ts:442` with "Type 'string | null' is not assignable to type 'string | undefined'" even after the source was updated.
