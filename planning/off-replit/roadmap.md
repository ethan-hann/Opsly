# Off-Replit Program — Roadmap

## Why

Opsly was bootstrapped on Replit; we're moving to a self-hosted, hands-on setup to cut cost. Two things prompted this program: (1) native `pnpm run dev` is broken by a dependency/Node mismatch, and (2) there's leftover Replit plumbing (CI workflows, a dead SDK, dev-only Vite plugins, an optional storage provider, and a `replit_oidc` auth mode) to remove.

Good news from the survey: the app is already **mostly** decoupled. Both storage and auth already default to `local` (`getStorageProvider()` and `parseAuthMode()` both fall back to `local` when their env var is unset; `docker-compose*.yml` and `.env*` use `${STORAGE_DRIVER:-local}`). So "default to local" is essentially already true — the remaining work is removing the Replit-specific paths and CI, not changing defaults.

## Sequencing principle

Each plan is independently shippable, reviewable as its own diff, and ordered by **dependency then risk**: unblock local dev first, then move CI, then remove leftovers from lowest-risk (dead code) to highest-risk (auth). Codex executes them one after another; later plans assume earlier ones have landed.

## The sequence

| # | Plan | What it does | Risk | Depends on |
|---|------|--------------|------|-----------|
| 01 | [Local dev build fix + Node pin](01-local-dev-build-fix/plan.md) | Fix the `ERR_REQUIRE_ESM` crash (bound `uuid` override to `>=11.1.1 <13`), pin Node 24, fail-fast preinstall guard, esbuild watch loop for the api-server, actionable `wait-for-api` message, native-setup README. | Low | — |
| 02 | [GitHub Actions CI + delete `.replit`](02-github-actions-ci/plan.md) | Port the three `.replit` validations (`api-server-tests`, `typecheck`, `orval-sync`) plus a new api-server boot smoke check into a GitHub Actions workflow (Node 24 + `postgres:16` service), then delete `.replit`. | Low–Med | 01 (Node pin, smoke script) |
| 03 | [Remove dead Replit code](03-remove-dead-replit-code/plan.md) | Remove the unused `@replit/connectors-sdk` dependency, the `REPL_ID`-gated Replit Vite dev plugins + their catalog entries, the `@replit/*` / `stripe-replit-sync` `minimumReleaseAgeExclude` entries, and `replit.md` / `replit.nix`. | Low | 02 (`.replit` already gone) |
| 04 | [Remove ReplitStorageProvider](04-remove-replit-storage/plan.md) | Delete `ReplitStorageProvider`, its factory branch and startup-validation branch, its tests, and the Replit sections of `SELF_HOSTING.md`. Leaves `local` (default) and `s3`. | Medium | 03 |
| 05 | [Decouple auth from Replit](05-decouple-auth/plan.md) | Drop the `replit_oidc` auth mode (keep generic `oidc` + `local`) and rename `@workspace/replit-auth-web` → a neutral name across all ~9 import sites and mocks. | Med–High (touches auth) | 04 |
| 06 | Deploy pipeline (planned) | Replace the deleted Replit `[deployment]` (autoscale) with a conventional **Docker build/push + host** pipeline — build the existing `Dockerfile`(s), push to a registry, deploy to a host. Scoped as its own plan once the target host is chosen. | TBD | 02 |

## Cross-cutting standards (apply to every plan)

- **American English** in all UI strings, comments, docs, and identifiers (per `.agents/memory/american-spellings.md`).
- **Post-merge procedure** (per `.agents/memory/post-merge-procedure.md`): schema push + api rebuild after merges; relevant if any plan touches schema (none currently do, but note it).
- **api-server esbuild quirks** (per `.agents/memory/api-server-build-quirks.md`): the server is bundled by esbuild from its own `node_modules` with `@google-cloud/*` externalized — do not change the bundle/externalization strategy to work around dependency issues.
- Each plan should produce a clean, self-contained diff and run `pnpm install` if it changes dependencies so the regenerated `pnpm-lock.yaml` is committed.

## Status

- **01 & 02**: full plan + Codex prompt written, ready to hand off.
- **03, 04, 05**: plan written (scope/risk/approach). Codex prompts are intentionally generated **just before each is executed**, so they reflect the actual tree state after the preceding plans land (especially 05, which depends on exact import sites and needs its own verification pass). Ask for the prompt when that plan reaches the top of the queue.
- **06**: direction decided (Docker build/push + host); to be scoped into a full plan once the target host is chosen. Not blocking 01–05.

## Notes carried forward

- **`@google-cloud/storage` removal** is deferred to Plan 04 (not checked now, in case something else surfaces before then). Once `ReplitStorageProvider` is removed, verify whether anything else imports `@google-cloud/*`; if not, removing that dependency also removes the `gaxios`/`uuid` chain that Plan 01's override works around, making that workaround far less load-bearing.
