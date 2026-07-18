---
name: Notes feature architecture
description: How the rich-text scratch pad notes feature is structured — DB, API, codegen, frontend.
---

# Notes Feature Architecture

## Rule
When adding a new entity to this monorepo, follow this exact sequence:
1. Write `lib/db/src/schema/<entity>.ts` and export from `index.ts`
2. Add OpenAPI paths + schemas to `lib/api-spec/openapi.yaml`
3. Run `pnpm --filter @workspace/api-spec run codegen` — this generates both `lib/api-zod` and `lib/api-client-react`
4. Write `artifacts/api-server/src/routes/<entity>.ts` using schemas from `@workspace/api-zod` (NOT raw `zod/v4`)
5. Register route in `artifacts/api-server/src/routes/index.ts`
6. Run `pnpm --filter @workspace/db run push` to push schema to DB
7. Write frontend pages and components using generated hooks from `@workspace/api-client-react`

**Why:** The api-server does not have `zod` as a direct dependency — it must import Zod schemas from `@workspace/api-zod`. Using `zod/v4` directly in api-server routes causes TS2307.

**How to apply:** Any new route file in `artifacts/api-server/src/routes/` must import validation schemas from `@workspace/api-zod`, not from `zod` or `zod/v4` directly.

## Notes-specific

- `useToast` import in the frontend is at `@/hooks/use-toast`, NOT `@/components/ui/use-toast`
- Generated Note type has `projectId?: number | null` (optional, not required) — prop interfaces must use `projectId?: number | null` not `projectId: number | null | undefined`
- TipTap packages must be added directly to `artifacts/it-task-manager/package.json` (not via `installLanguagePackages` which targets workspace root) then `pnpm install`
- `useCreateComment` requires `{ id: taskId, data: CommentInput }` — the `id` is the task ID
