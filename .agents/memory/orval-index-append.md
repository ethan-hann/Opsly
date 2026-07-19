---
name: Orval index.ts append bug
description: Orval appends to existing index.ts files rather than overwriting; fix via pre-codegen.mjs reset script; api-zod dist must be rebuilt after.
---

# Orval index.ts Append Bug

## The rule
Orval **appends** its generated exports to the existing `index.ts` files (both `lib/api-zod/src/index.ts` and `lib/api-client-react/src/index.ts`) every time codegen runs, creating duplicates.

## Why
Orval's `mode: "split"` writes to the workspace-level index file but doesn't check for or remove existing duplicate lines. `clean: true` only cleans the `generated/` subdirectory, not the workspace-level index.

## How to apply
- `lib/api-spec/pre-codegen.mjs` runs before orval (part of the `codegen` npm script) and:
  - Clears `lib/api-zod/src/index.ts` to empty (orval fully owns it)
  - Resets `lib/api-client-react/src/index.ts` to only the custom-fetch re-exports (orval appends generated hooks after)
- After any change to `lib/api-zod/src/index.ts`, rebuild the dist: `cd lib/api-zod && npx tsc -p tsconfig.json`
  - The dist `index.d.ts` is used by other packages (api-server etc.) via project references
  - If it's empty/stale, typecheck fails with TS2306 ("File is not a module")
- The `lib/api-spec/package.json` codegen script ends with `pnpm -w run typecheck:libs` which rebuilds the dist automatically after codegen

## Symptoms of breakage
- `tsc --build` (typecheck:libs) shows TS2306 on `@workspace/api-zod` imports
- `lib/api-zod/dist/index.d.ts` only contains `//# sourceMappingURL=index.d.ts.map` (empty declaration)
- Second test run (after orval-sync in validation) fails with 500 errors or module-not-found

## Root cause of TS2306 in validation
`.gitignore` has `dist` which ignores `lib/api-zod/dist/`. Validation starts with no dist. Fix was to remove `lib/api-zod` from root `tsconfig.json` project references so TypeScript resolves it via the `exports` field (`./src/index.ts`) directly — same pattern as `lib/api-client-react`. Do NOT add it back to project references.
