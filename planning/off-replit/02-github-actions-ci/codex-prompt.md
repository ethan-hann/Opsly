# Codex Prompt 02 (follow-up) — add boot smoke check + orval-sync drift to CI

## Task

Opsly already has a working GitHub Actions CI workflow at `.github/workflows/ci.yml` (a single `build-and-test` job on Node 24 with a `postgres:16` service, running typecheck → build → schema push → coverage-gated tests → DB integration tests). It replaced the old Replit `typecheck` and `api-server-tests` validations. Two gates are still missing and this change adds them:

1. **An api-server boot smoke check** — nothing currently starts the built server before merge, so a startup crash (e.g. a module-load `ERR_REQUIRE_ESM`) ships undetected. Add a script that boots `dist/index.mjs`, confirms `GET /api/healthz` returns 200, and shuts it down.
2. **An orval-sync drift check** — the old Replit `orval-sync` validation (regenerate the codegen, assert no git diff) was never ported. Add it so the generated API clients can't silently drift from the OpenAPI spec.

Do **not** delete `.replit` in this change (a later plan handles all Replit config removal). Do **not** restructure the existing single job or change how pnpm is installed.

### 1. Add the boot smoke script

Create `artifacts/api-server/scripts/smoke.mjs` (ES module; **no new dependencies** — use Node's built-in `fetch`, `child_process`, and `process`) that:

- Assumes the api-server is **already built** to `artifacts/api-server/dist/index.mjs` (CI runs `pnpm --filter @workspace/api-server run build` — or the existing repo-wide `Build` step — before calling it). Add a comment stating this precondition. Optionally fail fast with a clear message if `dist/index.mjs` is missing.
- Spawns `node --enable-source-maps ./dist/index.mjs` (matching the package's `start` script) from the api-server package dir, with `PORT` set to a fixed test port (e.g. `8080`) in the child's env. **No database and no storage env are required**: `artifacts/api-server/src/index.ts` requires `PORT`, calls `initStorageProvider()` (storage defaults to `local`, no required vars), then `app.listen`; all DB work is fire-and-forget inside the `listen` callback. `/api/healthz` (`src/routes/health.ts`) parses a static `{ status: "ok" }` via `HealthCheckResponse` and returns 200.
- Captures the child's `stderr` (and `stdout`) into a buffer.
- Polls `GET http://localhost:<port>/api/healthz` until it gets HTTP 200, with a ~30s overall timeout and a short delay between attempts.
- **On success:** send `SIGTERM` to the child (the server installs a `SIGTERM` handler that closes the HTTP server and exits 0), then exit 0.
- **On timeout, or if the child exits before healthz responds 200:** print the captured child stderr to the console and exit non-zero.
- Make sure the script itself doesn't hang: clear the timeout, unref or kill the child on all exit paths.

Add a `"smoke"` script to `artifacts/api-server/package.json`: `"smoke": "node ./scripts/smoke.mjs"`. Do not add dependencies.

### 2. Wire the smoke check into `ci.yml`

In the existing `build-and-test` job, add a step **after the `Build` step** (the bundle already exists at that point) and before or after the test steps:

```yaml
      - name: Boot smoke check (api-server)
        run: pnpm --filter @workspace/api-server run smoke
```

No new service or env is needed — the job already sets `PORT`/`DATABASE_URL`; the smoke script sets its own `PORT` for the child and ignores the DB. Do not add a separate job.

### 3. Replace the standalone `Typecheck` step with an orval-sync drift step

**Remove** the existing `Typecheck` step (`run: pnpm run typecheck`) and **replace it, in the same position**, with a step that regenerates the codegen and fails on any drift, mirroring the old `.replit` `orval-sync` command exactly:

```yaml
      - name: Typecheck + API codegen drift check
        run: |
          pnpm --filter @workspace/api-spec run codegen
          git diff --exit-code lib/api-zod/src/generated lib/api-client-react/src/generated
```

Why replace rather than add: the `codegen` script runs `pre-codegen.mjs → orval → post-codegen.mjs → pnpm -w run typecheck`, and that trailing `pnpm -w run typecheck` is the **identical command** the standalone `Typecheck` step runs (`pnpm run typecheck` from the repo root resolves to the same script). Keeping both would run the full workspace typecheck twice and make CI slower for no gain. Running codegen-then-typecheck is also the order the project requires (`.agents/memory/orval-codegen-command.md`: a typecheck against stale generated output throws phantom "missing export" errors). Name the step so a plain type error is still easy to spot in the Actions log (as above).

Notes for you (the implementer):
- Confirm before deleting: the `Build` step must run `pnpm -r --if-present run build` **directly** (not `pnpm run build`, which would itself typecheck). If Build calls `pnpm run build`, do not remove typecheck coverage without accounting for it. As written today, Build does not typecheck, so this combined step is the only typecheck — that is intended.
- Scope the `git diff` to the two `generated` dirs (as above). Do **not** diff the workspace-level `index.ts` files: `pre-codegen.mjs` clears/owns them, and orval's known append/reset behavior makes them noisy — the committed `generated/` output is the meaningful drift signal.

## Acceptance Criteria

- `artifacts/api-server/scripts/smoke.mjs` and a `"smoke"` npm script exist. Running `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run smoke` locally, **with no Postgres running**, boots the server, gets 200 from `/api/healthz`, and exits 0. If the server crashes at startup, the script prints the child's stderr and exits non-zero.
- `.github/workflows/ci.yml` gains a smoke step (after `Build`) that runs `pnpm --filter @workspace/api-server run smoke`, and the standalone `Typecheck` step is replaced (in place) by a combined step that runs `pnpm --filter @workspace/api-spec run codegen` then `git diff --exit-code lib/api-zod/src/generated lib/api-client-react/src/generated`.
- CI still runs the workspace typecheck exactly **once** (via the codegen step), not twice.
- The existing job structure, Node version, pnpm install approach, Postgres service, and coverage/DB-integration steps are unchanged apart from the smoke step added and the Typecheck step being replaced by the combined codegen+typecheck+drift step.
- No new npm dependencies. `pnpm-lock.yaml` unchanged.

## Relevant Files / Paths

- `.github/workflows/ci.yml` — existing single `build-and-test` job; add the two steps here.
- `artifacts/api-server/scripts/smoke.mjs` — new smoke script (dir does not exist yet — create it).
- `artifacts/api-server/package.json` — add the `smoke` script; `start` is already `node --enable-source-maps ./dist/index.mjs`.
- `artifacts/api-server/src/index.ts` — reference: `PORT` required, `initStorageProvider()` then `app.listen`, DB work is fire-and-forget, `SIGTERM` → graceful exit 0.
- `artifacts/api-server/src/routes/health.ts` — reference: static `/healthz` returning `{ status: "ok" }` via `HealthCheckResponse`.
- `lib/api-spec/package.json` — the `codegen` script the orval-sync step calls.
- `lib/api-zod/src/generated`, `lib/api-client-react/src/generated` — the generated dirs the drift check diffs.

## Standards to Follow

- **American English** in workflow names, comments, and script messages (`.agents/memory/american-spellings.md`).
- **Match the old `orval-sync` command exactly** so the drift check behaves identically to the retired Replit workflow (`.agents/memory/orval-codegen-command.md` documents that `codegen` = `pre-codegen → orval → post-codegen → typecheck`).
- Respect the orval index.ts append/reset behavior — do not "fix up" generated `index.ts` files or widen the diff to include them (`.agents/memory/orval-index-append.md`).
- Use Node built-ins only for the smoke script — the api-server is esbuild-bundled and must stay dependency-clean (`.agents/memory/api-server-build-quirks.md`).

## Out of Scope

- Do NOT delete `.replit`, `replit.md`, or `replit.nix` — Plan 03 removes all Replit config together.
- Do NOT add a deploy/release pipeline — Plan 06.
- Do NOT restructure the single `build-and-test` job into multiple jobs, change the Node version, or swap the pnpm bootstrap (the `npm install -g pnpm@…` approach is deliberate; its comment explains why Corepack is avoided).
- Do NOT weaken coverage or DB-integration steps. (The standalone `Typecheck` step *is* intentionally replaced by the combined codegen+typecheck+drift step — that is the one exception, and it must preserve the same typecheck command, just after codegen.)
- Do NOT change the api-server `dev`/`build`/`start` scripts (Plan 01 owns those).
- Do NOT expand the smoke check beyond booting + `/api/healthz`.
