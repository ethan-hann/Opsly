---
name: API server build quirks
description: esbuild bundling, zod dependency, and orval schema naming rules for this project
---

## esbuild bundling
The api-server builds with esbuild (see `artifacts/api-server/build.mjs`). Any package imported in api-server routes must be listed in `artifacts/api-server/package.json` dependencies — workspace-level catalog entries alone are not enough.

**Why:** esbuild resolves from the package's own node_modules, not the workspace root.

**How to apply:** If a new route imports `zod`, `uuid`, or any other package directly, add it to `artifacts/api-server/package.json` and run `pnpm install`.

## Orval schema naming — avoid `Body` and `Params` suffixes for component names
Orval (zod client, split mode) auto-generates validators named `<OperationId>Body` for request bodies and `<OperationId>Params` for query parameters. It also writes TypeScript types with the same names into `generated/types/`. Both land in `lib/api-zod/src/index.ts` via `export * from`, causing TS2308 duplicate-export errors.

**Why:** The index re-exports both `./generated/api` (Zod schemas) and `./generated/types` (TS types); same name from two modules fails.

**How to apply:** Never use `Body` or `Params` suffix for component schema names. Use `Input` for request bodies. For endpoints with query params, do NOT add optional `limit`/`page` query params if they would be the only params — remove them and hard-code the limit in the route handler to avoid generating a `<OperationId>Params` name collision.

## Orval index.ts duplication
`lib/api-zod/src/index.ts` is NOT in the cleaned output folder — orval APPENDS to it on each run rather than replacing it. Running codegen twice without clearing the file results in 4 export lines instead of 2, which causes TS2308 on the next new name.

**How to apply:** Before running codegen, reset the file: `echo 'export * from "./generated/api";\nexport * from "./generated/types";' > lib/api-zod/src/index.ts`

## Orval + zod v3: no `format: email`
The project uses zod v3 (3.x). Orval translates `format: email` in OpenAPI to `zod.email()`, which is a zod v4 standalone function and doesn't exist in v3.

**Why:** TypeScript build fails with "Property 'email' does not exist on type 'typeof zod'".

**How to apply:** Never use `format: email` in `lib/api-spec/openapi.yaml`. Validate email on the backend using `z.string().email()`.
