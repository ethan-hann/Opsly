# Copilot instructions for Opsly

Opsly is a web-based project and task manager that scales from solo use to full
engineering teams. It's a **pnpm monorepo**. Keep diffs minimal, reviewable, and
matched to the surrounding code's style — prefer following an existing pattern over
inventing a parallel one.

## Repo layout

- `artifacts/api-server` — Express backend (bundled with esbuild).
- `artifacts/it-task-manager` — React frontend (Vite).
- `lib/db` — Drizzle schema and DB access (`@workspace/db`).
- `lib/api-zod` — **generated** API validators/types (`@workspace/api-zod`).
- `lib/api-client-react` — **generated** React Query client.
- `lib/api-spec` — `openapi.yaml`, the source of truth for the generated packages.
- `lib/*` and `lib/integrations/*` — other shared workspace packages.

## The standards live in `.agents/` — read them before non-trivial work

`.agents/memory/` is a set of hard-won lesson notes, indexed by `.agents/memory/MEMORY.md`.
**Read the index first**, then open the specific notes relevant to what you're touching
(e.g. skip the markdown-editor/mermaid notes for a pure backend change). Don't guess at a
convention that a note already documents. `.github/agents/opsly-plan-executor.agent.md`
describes the implementation workflow when working from a `planning/<slug>/` bundle.

## Rules that always apply

- **American English everywhere** — UI strings, comments, identifiers, tests.
  organisation→organization, colour→color, behaviour→behavior, cancelled→canceled,
  centre→center. Do **not** rename existing DB columns, JSON field names, or URL paths
  (already American), third-party names, or spec terms (e.g. `onFulfilled`).
- **api-server validation uses `@workspace/api-zod`**, never raw inline `zod` schemas.
  Any package a route imports directly (`zod`, `uuid`, …) must be a real dependency in
  `artifacts/api-server/package.json` — esbuild bundles from the package's own
  `node_modules`, so the workspace catalog alone isn't enough. Then run `pnpm install`.
- **Generated code is a pipeline, not source to hand-edit.** If you change the API
  surface, edit `lib/api-spec/openapi.yaml` and regenerate — never hand-edit the `dist`
  or `index.ts` of `lib/api-zod` / `lib/api-client-react` (orval appends to `index.ts`
  on every run; `pre-codegen.mjs` resets them). After regenerating, those two generated
  packages' `dist` often needs an explicit rebuild — incremental root `tsc` doesn't pick
  them up. See `api-server-build-quirks.md`, `orval-index-append.md`,
  `api-client-react-dist-rebuild.md`.
- **After a schema change**, a `drizzle push` + api-server rebuild/restart is required
  before new routes work (a merged feature can 500 until then). Backfill migrations
  (e.g. NULLs blocking a new NOT NULL) stay manual. See `post-merge-procedure.md`.
- **DB-stored credentials use `encrypt()`/`decrypt()`** (`lib/encryption.ts`,
  AES-256-GCM). Such columns end in `_encrypted`; API responses expose only booleans
  like `hasPassword`, never the secret. See `secret-encryption.md`.
- **Supply-chain guard:** `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (1-day
  hold on new npm versions). Do not disable or weaken it.

## Commands

Run at the repo root (pnpm workspace):

```bash
pnpm install            # install (respects the release-age guard)
pnpm dev                # run api-server + frontend together
pnpm typecheck          # workspace typecheck
pnpm build              # typecheck + build all packages
```

Per package (use `--filter`, e.g. `pnpm --filter @workspace/api-server run test`):

- api-server: `build`, `start`, `typecheck`, `test` (vitest).
- it-task-manager: `build`, `typecheck`, `lint` (eslint), `test` (vitest),
  `test:e2e` (playwright).

## Workflow expectations

- Implement to explicit acceptance criteria when given; prefer the described behavior
  over your own idea of "better."
- Respect any "Out of Scope" list strictly — don't refactor or "clean up" adjacent
  files, and don't build follow-on features that weren't asked for.
- If a spec is genuinely ambiguous or a named path doesn't exist, stop and ask rather
  than papering over it.
- Before finishing, run the relevant `typecheck`/`test` for the packages you touched,
  and for any schema or API-surface change run the codegen/post-merge steps above — not
  just a compile.
