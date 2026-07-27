# 02 — GitHub Actions CI (+ boot smoke + orval-sync drift)

> Part of the [Off-Replit program](../roadmap.md). Depends on **01** (Node 24 pin + the boot smoke check builds on the pinned runtime).

## Status — partially shipped

The core CI workflow **already landed** as [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) and is green: a single `build-and-test` job on **Node 24** with a **`postgres:16` service container**, running typecheck → build → schema push (`push-force`) → coverage-gated tests → DB integration tests, with a per-package coverage gate and a coverage step summary. That covers (and exceeds) the old Replit `typecheck` and `api-server-tests` validations.

Two of this plan's original deliverables did **not** ship and are the remaining work here:

1. **api-server boot smoke check** — nothing today actually starts the built server before merge. There is no `artifacts/api-server/scripts/smoke.mjs` and no smoke step in CI. A regression like the `ERR_REQUIRE_ESM` crash from Plan 01 (or any module-load throw before `app.listen`) would still ship undetected, because the `Build` step compiles the bundle but never runs it.
2. **`orval-sync` drift check** — the old Replit `orval-sync` validation (regenerate codegen, assert no git diff) was **not** ported. Generated clients (`lib/api-zod`, `lib/api-client-react`) can drift from `lib/api-spec/openapi.yaml` with nothing in CI catching it.

One planned deliverable **moved**: deleting `.replit` is now folded into **Plan 03** (grouped with `replit.md` / `replit.nix` and the other Replit cleanup) so `.replit` is removed in the same reviewable diff as the rest of the Replit config. `.replit` is still present today.

## Scope (remaining work)

**In scope:**
- Add a **boot smoke check**: a repo script (`artifacts/api-server/scripts/smoke.mjs`) + a `smoke` npm script that starts the built `dist/index.mjs`, polls `GET /api/healthz` until 200, then shuts it down cleanly; exits non-zero (printing the child's stderr) if the process dies first. Wire it into `ci.yml` as a step after `Build`. Runs with **no DB** (see design notes).
- Add an **orval-sync drift step** to `ci.yml`: regenerate codegen, then `git diff --exit-code` the generated dirs — mirroring the exact command from the old `.replit` `orval-sync` workflow. Because the `codegen` script already ends with the full workspace typecheck, this step **replaces** the standalone `Typecheck` step (they run the identical command — see design notes) rather than being added alongside it, so CI still runs exactly one typecheck.

**Out of scope:**
- Deleting `.replit` / `replit.md` / `replit.nix` → **Plan 03**.
- Any deploy pipeline (build/push Docker image, release) → **Plan 06**. This plan is validation CI only.
- Restructuring the existing single `build-and-test` job into separate jobs — the single-job shape shipped and works; splitting it is not worth the churn.
- Changing the pnpm bootstrap (`npm install -g pnpm@10.34.5`). The workflow deliberately installs pnpm via npm rather than Corepack — the inline comment explains Corepack's signature check is unreliable. Leave it.

## Design notes

- **Smoke check needs no Postgres.** `artifacts/api-server/src/index.ts` requires `PORT`, calls `initStorageProvider()` (storage defaults to `local` — no required env), then `app.listen`; all DB work is fire-and-forget inside the `listen` callback. `/api/healthz` (`src/routes/health.ts`) parses a static `{ status: "ok" }` via `HealthCheckResponse` from `@workspace/api-zod` and returns 200 — so the smoke check exercises that the bundled api-zod validators loaded, which is exactly the module-load surface the `ERR_REQUIRE_ESM` class of bug breaks. `SIGTERM` triggers a graceful shutdown that exits 0. So the smoke job only needs a successful `Build` first and a `PORT`; keep it DB-free so it stays fast. The existing job sets a job-level `DATABASE_URL`, which the smoke step harmlessly ignores.
- **Reuse the smoke script.** Put the logic in `artifacts/api-server/scripts/smoke.mjs` + a `smoke` npm script so a contributor can reproduce a CI failure locally (`pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run smoke`). No new dependencies — use Node's built-in `fetch` and `child_process`.
- **orval-sync placement — one step, one typecheck.** The `codegen` script (`pnpm --filter @workspace/api-spec run codegen`) runs `pre-codegen.mjs → orval → post-codegen.mjs → pnpm -w run typecheck` — so it regenerates the sources *and* runs the full workspace typecheck. That trailing `pnpm -w run typecheck` is the **identical command** the standalone CI `Typecheck` step runs (`pnpm run typecheck` from the repo root → `typecheck:libs` + all artifact/script typechecks). So the orval-sync step should take the standalone step's slot: codegen → typecheck → `git diff --exit-code` the two generated source dirs. This keeps CI at one typecheck and matches the project rule that codegen must precede typecheck (`.agents/memory/orval-codegen-command.md`) — a standalone typecheck-first step is both redundant and slightly wrong-ordered. Because `pre-codegen.mjs` clears the `index.ts` files and orval owns them, keep the diff scoped to the generated dirs the old `.replit` check used (see prompt), not the whole `src/`.

## User Stories

- **As a maintainer,** every PR runs typecheck, coverage-gated tests, an api-server boot smoke check, and an orval-sync drift check on GitHub Actions — the gates Replit gave us, plus the boot check, plus a real coverage floor.
- **As a contributor,** I can run the same boot smoke check locally (`pnpm --filter @workspace/api-server run smoke`) to reproduce a CI failure.
- **As a maintainer,** the generated API clients can't silently drift from the OpenAPI spec — CI regenerates and fails on any diff.

## Open Questions / Risks

- **orval-sync determinism in CI.** The check regenerates codegen and asserts no git diff. Codegen is deterministic on Replit today; confirm it stays deterministic on `ubuntu-latest`. Mirror the exact command from the old `.replit` `orval-sync` workflow (`git diff --exit-code lib/api-zod/src/generated lib/api-client-react/src/generated`). Note the known orval index.ts append/reset behavior (`.agents/memory/orval-index-append.md`) — the diff is intentionally scoped to `generated/`, not the workspace-level `index.ts`.
- **Failure attribution.** Folding typecheck into the codegen step means a plain type error now surfaces under the codegen/drift step rather than a step literally named "Typecheck." Mitigate with a clear step name (e.g. "Typecheck + API codegen drift check") so the cause is obvious in the Actions log.
- **Where does the smoke step run?** Simplest is to add it to the existing `build-and-test` job right after `Build` (the bundle already exists there). It needs no DB, so it can also be a separate no-service job; the single-job placement is preferred to avoid re-installing/re-building. Confirm the built entry path is `artifacts/api-server/dist/index.mjs`.
- **Deploy is still not covered** (Plan 06). Deleting `.replit` (in Plan 03) removes the Replit `[deployment]` autoscale config; the replacement Docker build/push pipeline remains a conscious follow-up, not an accidental gap.
