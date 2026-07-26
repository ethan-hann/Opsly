# 02 — GitHub Actions CI + Delete `.replit`

> Part of the [Off-Replit program](../roadmap.md). Depends on **01** (Node 24 pin + the boot smoke check introduced here builds on the pinned runtime).

## Problem / Goal

Validation currently runs as Replit `[workflows]` in `.replit`: `api-server-tests`, `typecheck`, and `orval-sync` (all `isValidation = true`). Moving off Replit means those checks stop running. We need equivalent checks on GitHub Actions, plus a new **api-server boot smoke check** (nothing today actually starts the built server before merge, so a regression like the `ERR_REQUIRE_ESM` crash in Plan 01 would ship undetected). Then delete `.replit` entirely.

## Scope

**In scope:**
- A GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on push/PR, on **Node 24**, with pnpm (via `packageManager`), and a **`postgres:16` service container** providing `DATABASE_URL` so DB-dependent suites actually run (the `lib/db` suites auto-skip when `DATABASE_URL` is unset — `create-local-user.test.ts` / `make-admin.test.ts` use `describeIf`).
- Jobs mirroring the three existing validations: `typecheck` (`pnpm run typecheck`), `api-server-tests` (`pnpm --filter @workspace/api-server test`), and `orval-sync` (`pnpm --filter @workspace/api-spec run codegen` then `git diff --exit-code` on the generated dirs).
- A new **boot smoke check**: build the api-server, start `dist/index.mjs`, poll `GET /api/healthz` until 200, then shut down; fail non-zero if the process dies first. Runs on Node 24 with no DB (see below).
- Run DB schema push (`pnpm --filter @workspace/db run push`) against the service DB before the suites that need it.
- Delete `.replit`.

**Out of scope:**
- Deleting `replit.md` / `replit.nix` → **Plan 03** (grouped with the other doc/config cleanup).
- Any deploy pipeline (build/push Docker image, release) — this plan is validation CI only. Flagged as a follow-up.
- Removing Replit code → **Plans 03–05**.

## Design notes

- **Smoke check needs no Postgres.** `artifacts/api-server/src/index.ts` calls `app.listen` before any DB work (all DB calls are fire-and-forget after listen) and `/api/healthz` (`src/routes/health.ts`) is a static 200. The bug this guards against crashes at module-load, before `listen`. So the smoke job only needs `PORT` and whatever `initStorageProvider()` requires — and since storage defaults to `local` (no required env), nothing extra is needed. Keep it DB-free so it stays fast.
- **The other suites may need the DB.** The `api-server` tests and `lib/db` tests should run with `DATABASE_URL` pointing at the service container so DB-gated cases execute rather than silently skip. Push the schema first.
- **Reuse the smoke script.** Introduce the smoke logic as a script in the repo (e.g. `artifacts/api-server/scripts/smoke.mjs` + a `smoke` npm script) so it's runnable locally too, and have CI call `pnpm --filter @workspace/api-server run smoke`.

## User Stories

- **As a maintainer,** every PR runs typecheck, api-server tests, orval-sync drift check, and an api-server boot smoke check on GitHub Actions — the same gates Replit gave us, plus the boot check.
- **As a contributor,** I can run the same boot smoke check locally (`pnpm --filter @workspace/api-server run smoke`) to reproduce a CI failure.
- **As a maintainer,** `.replit` is gone; nothing depends on Replit to validate a change.

## Open Questions / Risks

- **Do the api-server tests require a live DB or do they mock it?** They import `@workspace/db` widely. The safe design is to provide the `postgres:16` service + `DATABASE_URL` + a schema push regardless, so tests that need it pass and tests that mock it are unaffected. Codex should confirm while wiring the job (check `artifacts/api-server/vitest.config.ts` and a couple of the DB-touching tests for whether they mock `@workspace/db`).
- **`orval-sync` determinism:** the check regenerates codegen and asserts no git diff. Confirm codegen is deterministic in CI (it is on Replit today). Mirror the exact command from the old `.replit` workflow.
- **Deploy is not covered here.** Deleting `.replit` removes the Replit `[deployment]` (autoscale) config. This plan does not add a replacement deploy pipeline — call that out so it's a conscious follow-up, not an accidental gap.
- **`packageManager` + Corepack:** the workflow should honor the pinned pnpm from Plan 01 (`corepack enable` or `pnpm/action-setup` with the matching version) so local and CI use the same pnpm.
