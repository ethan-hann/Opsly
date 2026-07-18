---
name: API server build quirks
description: esbuild bundling, zod dependency, and orval schema naming rules for this project
---

## esbuild bundling
The api-server builds with esbuild (see `artifacts/api-server/build.mjs`). Any package imported in api-server routes must be listed in `artifacts/api-server/package.json` dependencies — workspace-level catalog entries alone are not enough.

**Why:** esbuild resolves from the package's own node_modules, not the workspace root.

**How to apply:** If a new route imports `zod`, `uuid`, or any other package directly, add it to `artifacts/api-server/package.json` and run `pnpm install`.

## Orval schema naming — avoid `Body` suffix for component names
Orval (zod client, split mode) auto-generates request-body validators named `<OperationId>Body` (e.g. `createOrg` → `CreateOrgBody`). If a component schema in `openapi.yaml` is *also* named `CreateOrgBody`, orval puts it in both `generated/api.ts` and `generated/types/`, causing a TS2308 duplicate-export error from `lib/api-zod/src/index.ts`.

**Why:** The index re-exports both `./generated/api` and `./generated/types`; duplicate named exports from two modules fail.

**How to apply:** Always use the `Input` suffix for component schemas (e.g. `OrgInput`, `InviteMemberInput`) — never the `Body` suffix. The `Body` namespace belongs to orval's auto-generated validators.

## Orval + zod v3: no `format: email`
The project uses zod v3 (3.x). Orval translates `format: email` in OpenAPI to `zod.email()`, which is a zod v4 standalone function and doesn't exist in v3.

**Why:** TypeScript build fails with "Property 'email' does not exist on type 'typeof zod'".

**How to apply:** Never use `format: email` in `lib/api-spec/openapi.yaml`. Validate email on the backend using `z.string().email()`.
