---
name: Orval codegen sync command
description: The happy-path command to regenerate api-zod / api-client-react from openapi.yaml; must run before typecheck after any API-surface change.
---

# Orval Codegen Sync Command

## The rule
`lib/api-zod` and `lib/api-client-react` are **generated** from
`lib/api-spec/openapi.yaml` by orval. After any change to the API surface (the OpenAPI
spec), regenerate them with the codegen script — run from the repo root:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This runs `pre-codegen.mjs → orval → post-codegen.mjs → pnpm -w run typecheck`
(see `lib/api-spec/package.json`). Never hand-edit the generated `dist` or `index.ts`
outputs.

## Why
The generated packages emit the zod validators and TypeScript types that the rest of
the repo compiles against. **Codegen must run before typecheck passes:** a `typecheck`
against stale generated output fails with phantom "has no exported member" / TS2305 /
TS2306 errors that look like real bugs but only mean the generated types are out of
date. `post-codegen.mjs` also rewrites and dedupes the generated `index.ts` files, so
you don't hand-fix them.

## How to apply
- Edit `lib/api-spec/openapi.yaml`, then run the command above — don't edit
  `lib/api-zod` / `lib/api-client-react` sources directly.
- The script already ends with a workspace typecheck, so a green run means the
  generated types are in sync.
- If you hit a duplicate-export or stale-`dist` failure, that's a known pitfall, not a
  new problem — see [[orval-index-append]], [[api-zod-tsbuildinfo-stale]], and
  [[api-client-react-dist-rebuild]]. Watch the schema-naming rules in
  [[api-server-build-quirks]] (no `Body`/`Params`/`format: email`) that keep codegen
  clean in the first place.
