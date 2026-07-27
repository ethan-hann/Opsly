# 03 — Remove Dead Replit Code

> Part of the [Off-Replit program](../roadmap.md). Depends on **02** (CI ported to GitHub Actions, so nothing relies on Replit to validate a change). Low risk — all removals are of code/config that is unused or Replit-only-gated.

## Problem / Goal

With CI moved off Replit, several Replit-specific artifacts are now pure dead weight. Remove them — including the `.replit` config itself (its validation `[workflows]` are now redundant with GitHub Actions, and its `[deployment]` autoscale config is retired in favor of the Plan 06 pipeline) — to shrink the dependency surface, the supply-chain exclusion list, and the config/docs.

## Scope

**In scope — remove:**
- **`.replit`** — the Replit config file. Its three validation `[workflows]` (`typecheck`, `api-server-tests`, `orval-sync`) will be covered by `.github/workflows/ci.yml` once Plan 02’s smoke check + orval-sync drift check land, and its `[deployment]` autoscale block is being replaced by the Plan 06 Docker pipeline. Delete the file. Note in the PR that this removes the Replit autoscale deploy config and that the replacement pipeline is a separate follow-up (Plan 06) — no deploy pipeline is added here.
- **`@replit/connectors-sdk`** — a root `package.json` dependency with **zero usages** anywhere in `artifacts/` or `lib/` (confirmed by grep). Dead. Remove from `package.json` and re-run `pnpm install`.
- **Replit Vite dev plugins** — `@replit/vite-plugin-runtime-error-modal`, `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`. In `artifacts/it-task-manager/vite.config.ts` they are dynamically imported only when `process.env.NODE_ENV !== 'production' && !!process.env.REPL_ID?.trim()` — i.e. only ever loaded inside Replit. Remove the guarded plugin block, the three `catalog:` entries in `pnpm-workspace.yaml`, and any devDependency references to them.
- **`minimumReleaseAgeExclude` cruft** in `pnpm-workspace.yaml` — the `- '@replit/*'` and `- stripe-replit-sync` entries (the latter only matters if `stripe-replit-sync` is otherwise unreferenced — verify before removing). These exist only to fast-track Replit-published packages we're removing.
- **`replit.md`** and **`replit.nix`** — Replit-specific project doc and Nix env. `replit.md` contains generic "first-time setup" notes (instance-admin token, etc.) that may be worth preserving elsewhere — see open questions.

**Out of scope:**
- `ReplitStorageProvider` → **Plan 04**.
- `replit_oidc` auth mode / `@workspace/replit-auth-web` rename → **Plan 05**.

## Open Questions / Risks

- **`replit.md` has reusable content.** Its "First-time setup" section (instance-admin bootstrap via `INSTANCE_ADMIN_TOKEN` or a local admin user) is genuinely useful and not Replit-specific. Decision: fold that content into `README.md` (or a `SELF_HOSTING`/`docs/` file) before deleting `replit.md`, rather than losing it. Confirm with Ethan where it should live.
- **`stripe-replit-sync`** — confirm it isn't referenced anywhere (deps, code, catalog) before pulling its `minimumReleaseAgeExclude` entry; if it's genuinely unused, note whether it's also a dependency that should be removed.
- **Vite config after removal** — ensure `vite.config.ts` still has a valid `plugins` array (the block is a spread of a conditional array; removing it must not leave a dangling `...(...)` or a syntax error). The dev banner/error-modal loss has no functional impact off Replit.
- Low blast radius overall, but re-run `pnpm install`, `pnpm run typecheck`, and the frontend build to confirm nothing referenced the removed catalog entries.

## Codex prompt

See [codex-prompt.md](codex-prompt.md) — generated against the current tree (after 02 landed), reflecting the present `pnpm-workspace.yaml` and `vite.config.ts`.

**Open questions resolved during generation (by exploring the repo):**
- **`replit.md` reusable content** — its "First-time setup" section (instance-admin bootstrap via `INSTANCE_ADMIN_TOKEN` and `make-admin`, plus the startup warning) is **already fully documented** in both `SELF_HOSTING.md` and `LOCAL_DEV.md`. Nothing needs to be migrated; `replit.md` can be deleted outright.
- **`stripe-replit-sync`** — appears **only** in its own `minimumReleaseAgeExclude` entry (no dependency, no code, no catalog reference). Safe to remove the exclude entry; there is no dependency to also pull.
