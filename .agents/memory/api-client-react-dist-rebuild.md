---
name: api-client-react dist rebuild
description: After orval codegen, tsc incremental compilation skips api-client-react because it is not in the root tsconfig.json references; stale .d.ts files then cause typecheck failures in it-task-manager.
---

## The rule
After running orval codegen, always rebuild `lib/api-client-react` explicitly before running the full typecheck.

**Why:** `lib/api-client-react` is NOT listed in the root `tsconfig.json` references (only `lib/db`, `lib/api-zod`, `lib/replit-auth-web` are). So `pnpm run typecheck:libs` (`tsc --build` at root) does NOT rebuild `api-client-react`. But `it-task-manager/tsconfig.json` lists it in its own `references`, so `tsc --noEmit` for the frontend uses the stale compiled `.d.ts` files in `lib/api-client-react/dist/generated/`. The `.tsbuildinfo` makes incremental tsc skip rebuilding even when sources changed.

**How to apply:**
1. After `pnpm --filter @workspace/api-spec run codegen`, run:
   ```
   cd lib/api-client-react && npx tsc -p tsconfig.json
   ```
   This regenerates `dist/generated/api.schemas.d.ts` etc. with the new types.
2. If tsc --build still uses stale files, delete `lib/api-client-react/tsconfig.tsbuildinfo` and/or `lib/api-client-react/dist/generated/` and rebuild.
3. Only after this step will `typecheck` for `it-task-manager` pass with the new generated types.
