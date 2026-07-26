# Codex Prompt 02 — GitHub Actions CI + delete `.replit`

## Task

Opsly is moving off Replit. Validation currently runs as Replit `[workflows]` in the `.replit` file: `api-server-tests` (`pnpm --filter @workspace/api-server test`), `typecheck` (`pnpm run typecheck`), and `orval-sync` (`pnpm --filter @workspace/api-spec run codegen` then `git diff --exit-code lib/api-zod/src/generated lib/api-client-react/src/generated`), all marked `isValidation = true`. Recreate these as a GitHub Actions workflow, add a new api-server boot smoke check, then delete `.replit`.

Assume Plan 01 has landed: Node is pinned to 24 (`.nvmrc`, root `engines.node`, and a `packageManager` field pinning pnpm), and `pnpm run dev` works locally.

1. **Add a boot smoke script.** Create `artifacts/api-server/scripts/smoke.mjs` (no new dependencies — use Node's built-in `fetch` and `child_process`) that:
   - Builds the api-server if needed (either run `pnpm run build` first in CI, or have the script shell out to the build; prefer building in a CI step and having the script assume `dist/index.mjs` exists — pick one and document it in a comment).
   - Spawns `node --enable-source-maps ./dist/index.mjs` with `PORT` set to a fixed test port (e.g. 8080) and `NODE_ENV` unset or `development`. **No database and no storage env are required**: `artifacts/api-server/src/index.ts` calls `app.listen` before any DB work, `/api/healthz` (`src/routes/health.ts`) is a static 200, and storage defaults to `local` (no required vars).
   - Polls `GET http://localhost:<port>/api/healthz` until 200, with a ~30s timeout.
   - On success: send SIGTERM to the child, exit 0. On timeout or if the child exits before healthz responds: print the child's captured stderr and exit non-zero.
   - Add a `"smoke"` script to `artifacts/api-server/package.json` (e.g. `"smoke": "node ./scripts/smoke.mjs"`). Do not add dependencies.

2. **Add the GitHub Actions workflow** at `.github/workflows/ci.yml`, triggered on `push` and `pull_request`. Use Node 24 and the repo's pinned pnpm (via `corepack enable` honoring the `packageManager` field, or `pnpm/action-setup` pinned to the same version). Structure it as jobs mirroring the old validations plus the smoke check:
   - **typecheck**: `pnpm install --frozen-lockfile` then `pnpm run typecheck`.
   - **orval-sync**: `pnpm install --frozen-lockfile`, `pnpm --filter @workspace/api-spec run codegen`, then `git diff --exit-code lib/api-zod/src/generated lib/api-client-react/src/generated` (mirror the exact command from the current `.replit` `orval-sync` workflow).
   - **api-server-tests**: run with a `postgres:16` **service container** (health-checked) exposing 5432; set `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/opsly` (match the credentials used by `docker-compose.local.yml`); run `pnpm --filter @workspace/db run push` to apply the schema; then `pnpm --filter @workspace/api-server test`. First inspect `artifacts/api-server/vitest.config.ts` and a few DB-touching tests to confirm whether they mock `@workspace/db` or need the real DB — provide the service DB regardless so both cases work; the `lib/db` suites (`create-local-user.test.ts`, `make-admin.test.ts`) skip themselves when `DATABASE_URL` is unset, so the DB must be present for them to actually run.
   - **smoke**: `pnpm install --frozen-lockfile`, `pnpm --filter @workspace/api-server run build`, then `pnpm --filter @workspace/api-server run smoke`. No DB service on this job.
   - Set a sensible `MINIMUM_RELEASE_AGE`-friendly install (the workspace enforces `minimumReleaseAge`; `--frozen-lockfile` installs from the committed lockfile so this is fine).

3. **Delete `.replit`.** Remove the file entirely. Do NOT delete `replit.md` or `replit.nix` in this change (a later plan handles those). Note in the PR description that removing `.replit` also removes the Replit `[deployment]` (autoscale) config and that a replacement deploy pipeline is a separate follow-up — do not add one here.

## Acceptance Criteria

- `.github/workflows/ci.yml` exists and defines jobs equivalent to `typecheck`, `orval-sync`, `api-server-tests` (with a `postgres:16` service + schema push), and a new `smoke` job — all on Node 24 with the pinned pnpm.
- `artifacts/api-server/scripts/smoke.mjs` and the `smoke` npm script exist; running `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run smoke` locally boots the server, gets 200 from `/api/healthz`, and exits 0 with **no Postgres running**. If the server crashes at startup, it exits non-zero and prints the child's stderr.
- The `orval-sync` job uses the same codegen + `git diff --exit-code` commands as the current `.replit` workflow.
- `.replit` is deleted. `replit.md` and `replit.nix` remain untouched.
- No new npm dependencies were added. `pnpm-lock.yaml` is unchanged except as a result of `pnpm install` if anything shifted (ideally unchanged).

## Relevant Files / Paths

- `.replit` — current source of the three validation workflows and their exact commands; delete after porting.
- `.github/workflows/ci.yml` — new workflow (there is currently no `.github/workflows/` dir; `.github/agents/` exists).
- `artifacts/api-server/scripts/smoke.mjs` — new smoke script.
- `artifacts/api-server/package.json` — add `smoke` script.
- `artifacts/api-server/src/index.ts` — reference: shows `listen` precedes DB work (smoke needs no DB).
- `artifacts/api-server/src/routes/health.ts` — reference: the static `/healthz` handler.
- `artifacts/api-server/vitest.config.ts` — reference: determine DB needs of the api-server suite.
- `lib/db/src/create-local-user.test.ts`, `lib/db/src/make-admin.test.ts` — reference: DB-gated suites that skip without `DATABASE_URL`.
- `docker-compose.local.yml` — reference for the Postgres credentials/URL to match.
- Root `package.json` — `packageManager` field (from Plan 01) the workflow should honor.

## Standards to Follow

- **American English** in workflow names, comments, and any docs.
- Use `--frozen-lockfile` for installs in CI (respects the committed lockfile and the `minimumReleaseAge` policy).
- Match the exact `orval-sync` command from `.replit` so the drift check behaves identically.

## Out of Scope

- Do NOT add a deploy/release pipeline (Docker build-and-push, environment deploys) — validation CI only; flag deploy as a follow-up.
- Do NOT delete `replit.md` or `replit.nix` (Plan 03).
- Do NOT remove or modify any Replit application code — Vite plugins, storage provider, auth mode, `@replit/*` dependencies (Plans 03–05).
- Do NOT add npm dependencies for the smoke script.
- Do NOT change the api-server `dev`/`build`/`start` scripts (Plan 01 owns those).
- Do NOT expand the smoke check beyond booting + `/api/healthz`.
