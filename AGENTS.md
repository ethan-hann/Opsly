# Agent instructions for Opsly

This is the canonical, tool-neutral guide for any AI coding agent working in this repo
(Claude Code, Copilot, Cursor, ...). Tool-specific entry points should point here
rather than restating it: `.github/copilot-instructions.md` and
`.github/agents/opsly-plan-executor.agent.md` add only what is specific to the Copilot
coding agent's sandbox.

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

## Standards and memory live in `.agents/` — read before non-trivial work

`.agents/memory/` is a set of hard-won lesson notes, indexed by
[`.agents/memory/MEMORY.md`](.agents/memory/MEMORY.md). **Read the index first**, then
open the specific notes relevant to what you're touching (e.g. skip the
markdown-editor/mermaid notes for a pure backend change). Don't guess at a convention
that a note already documents.

## Skills

`.agents/skills/` holds reusable agent workflows for this repo. These files are the
**source of truth** for the skill; any tool-side install (e.g. a Claude skill of the
same name) should mirror them, not diverge.

- [`opsly-feature-planner`](.agents/skills/opsly-feature-planner.md) — turns a feature
  idea into a short plan plus an implementation spec, grounded in `.agents/`. The
  implementation is then handed off to the executor described in
  [`.github/agents/opsly-plan-executor.agent.md`](.github/agents/opsly-plan-executor.agent.md).

## Rules that always apply

- **American English everywhere** — UI strings, comments, identifiers, tests.
  organisation→organization, colour→color, behaviour→behavior, cancelled→canceled,
  centre→center. Do **not** rename existing DB columns, JSON field names, or URL paths
  (already American), third-party names, or spec terms (e.g. `onFulfilled`).
- **Comment only what the code cannot say itself.** Opsly's code should read as
  self-documenting — an experienced developer can infer *what* a well-named function or
  block does from the code alone, so don't narrate it. Explain **why**, never **what**:
  reserve comments for non-obvious rationale — an edge case, a workaround (link the
  issue), an invariant, a surprising constraint or ordering dependency. No design
  autobiography and no history in comments ("changed to…", "used to…", "now also
  handles…") — that belongs in the commit message or PR, not the source. Prefer deleting
  a stale or redundant comment over updating it. **Before committing, re-read your diff
  and remove every comment that doesn't earn its place by this rule** — this applies to
  comments you write *and* superfluous ones you notice in code you're already editing.
- **api-server validation uses `@workspace/api-zod`**, never raw inline `zod` schemas.
  Any package a route imports directly (`zod`, `uuid`, ...) must be a real dependency in
  `artifacts/api-server/package.json` — esbuild bundles from the package's own
  `node_modules`, so the workspace catalog alone isn't enough. Then run `pnpm install`.
- **Generated code is a pipeline, not source to hand-edit.** `lib/api-zod` and
  `lib/api-client-react` are generated from `lib/api-spec/openapi.yaml` by orval. If you
  change the API surface, edit `openapi.yaml` and **run the codegen sync** — never
  hand-edit the generated `dist` or `index.ts` (orval appends to `index.ts` on every
  run). Run from the repo root:

  ```bash
  pnpm --filter @workspace/api-spec run codegen
  ```

  This runs `pre-codegen → orval → post-codegen → workspace typecheck`. It **must run
  before typechecking passes** — the rest of the repo depends on the types it emits, so
  a `typecheck` on stale generated output will report phantom "has no exported member"
  errors. `post-codegen.mjs` already rewrites/dedupes the generated `index.ts` files, so
  you don't hand-fix them. See `orval-index-append.md`, `api-server-build-quirks.md`,
  `api-client-react-dist-rebuild.md`.
- **After a schema change**, a `drizzle push` + api-server rebuild/restart is required
  before new routes work (a merged feature can 500 until then). Backfill migrations
  (e.g. NULLs blocking a new NOT NULL) stay manual. See `post-merge-procedure.md`.
- **DB-stored credentials use `encrypt()`/`decrypt()`** (`lib/encryption.ts`,
  AES-256-GCM). Such columns end in `_encrypted`; API responses expose only booleans
  like `hasPassword`, never the secret. See `secret-encryption.md`.
- **Supply-chain guard:** `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (1-day
  hold on new npm versions). Do not disable or weaken it.
- **No per-platform binary overrides:** never add `pnpm-workspace.yaml` `overrides`
  that prune native binaries (esbuild/rollup/lightningcss/tailwind-oxide/ngrok) to a
  single platform — pnpm already installs only the host's binary, so it gives no
  Docker benefit and breaks native installs on macOS/Windows/ARM. See
  `.agents/memory/pnpm-no-platform-overrides.md`.

## Commands

Run at the repo root (pnpm workspace):

```bash
pnpm install            # install (respects the release-age guard)
pnpm dev                # run api-server + frontend together
pnpm typecheck          # workspace typecheck
pnpm build              # typecheck + build all packages

pnpm --filter @workspace/api-spec run codegen   # sync generated api-zod / api-client-react
                                                 # from openapi.yaml (required after any
                                                 # API-surface change, before typecheck)
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
- **After any change to the API surface (`lib/api-spec/openapi.yaml`), run the codegen
  sync** (`pnpm --filter @workspace/api-spec run codegen`) before you typecheck —
  otherwise the generated types are stale and typecheck fails with phantom errors.
- Before finishing, run the relevant `typecheck`/`test` for the packages you touched,
  and for any schema change run the drizzle push / post-merge steps above — not just a
  compile.
- **New or changed behavior ships with tests in the same diff.** api-server and
  it-task-manager enforce a per-package coverage floor (`vitest.config.ts` thresholds);
  run `pnpm --filter <pkg> run test:coverage` and add tests until it passes — CI fails
  the build otherwise. When mocking a shared module, spread the real one via
  `importOriginal` and override only what you control, so adding an export never breaks
  the mock. See `.agents/memory/test-mock-resilience.md`.
