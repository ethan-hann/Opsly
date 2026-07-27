# Codex Prompt 03 — Remove dead Replit code

## Task

Opsly was bootstrapped on Replit and has since moved CI to GitHub Actions (`.github/workflows/ci.yml` is green and covers typecheck, build, coverage-gated tests, a boot smoke check, and an orval-sync drift check). Several Replit-specific artifacts are now pure dead weight. Remove them to shrink the dependency surface, the supply-chain exclusion list, and the config/docs.

This is a **low-risk cleanup**: every item below is either unused or only ever active inside Replit (gated on `REPL_ID`), so removing it has no functional effect off Replit. Do all of the following in a single, self-contained diff:

1. **Delete the `.replit` config file** (repo root). Its three validation `[workflows]` (`typecheck`, `api-server-tests`, `orval-sync`) are now covered by `.github/workflows/ci.yml`, and its `[deployment]` autoscale block is being retired. **Do not add a replacement deploy pipeline** — that is a separate future plan. In your PR/commit description, note that this removes the Replit autoscale deploy config and that the replacement (Docker build/push + host) is a separate follow-up.

2. **Remove the unused `@replit/connectors-sdk` dependency** from the root `package.json`. It is the only entry in the root `dependencies` object and has **zero usages** anywhere in `artifacts/` or `lib/`. Remove the entry (leaving an empty `"dependencies": {}` object is fine, or remove the now-empty `dependencies` key entirely — either is acceptable).

3. **Remove the Replit Vite dev plugins.** In `artifacts/it-task-manager/vite.config.ts`, remove the guarded plugin block that dynamically imports `@replit/vite-plugin-runtime-error-modal`, `@replit/vite-plugin-cartographer`, and `@replit/vite-plugin-dev-banner` (it is spread into the `plugins` array behind `process.env.NODE_ENV !== 'production' && !!process.env.REPL_ID?.trim()`, so it only ever loads inside Replit). Also remove:
   - The three `@replit/vite-plugin-*` entries from `devDependencies` in `artifacts/it-task-manager/package.json`.
   - The three matching `catalog:` entries in `pnpm-workspace.yaml`.

4. **Remove the `minimumReleaseAgeExclude` cruft** in `pnpm-workspace.yaml`: the `- '@replit/*'` and `- stripe-replit-sync` entries. Both exist only to fast-track Replit-published packages we're removing. Removing both empties the list, so also remove the now-empty `minimumReleaseAgeExclude:` key and its inline explanatory comment (the short comment directly above/among those two entries that says the `@replit` packages are Replit-published and trusted). **Keep** the large `minimumReleaseAge: 1440` setting and its full SECURITY documentation block — that is the supply-chain defense and must stay.

5. **Delete `replit.md` and `replit.nix`** (repo root). `replit.md`'s only non-Replit-specific content — the "First-time setup" instance-admin bootstrap (static `INSTANCE_ADMIN_TOKEN` bearer path + `make-admin` promotion + startup warning) — is **already fully documented** in `SELF_HOSTING.md` and `LOCAL_DEV.md`, so nothing needs to be migrated. Just delete both files.

6. **Re-run `pnpm install`** so the regenerated `pnpm-lock.yaml` (with the four removed packages gone) is part of the diff and committed.

## Acceptance Criteria

- `.replit`, `replit.md`, and `replit.nix` no longer exist at the repo root.
- Root `package.json` no longer lists `@replit/connectors-sdk` under `dependencies`.
- `artifacts/it-task-manager/vite.config.ts` no longer imports or references any `@replit/vite-plugin-*` package. The `plugins` array is still valid — no dangling `...(...)` spread, trailing comma, or syntax error where the guarded block used to be. `react()`, `tailwindcss()`, and `VitePWA({...})` remain, and the `import path from 'path'` at the top stays (it is still used by `resolve.alias` / `build.outDir`).
- `artifacts/it-task-manager/package.json` no longer lists `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, or `@replit/vite-plugin-runtime-error-modal`.
- `pnpm-workspace.yaml` no longer contains the three `@replit/vite-plugin-*` catalog entries, nor the `@replit/*` / `stripe-replit-sync` `minimumReleaseAgeExclude` entries. The `minimumReleaseAge: 1440` setting and its SECURITY comment block are untouched.
- `pnpm-lock.yaml` is regenerated (via `pnpm install`) and reflects the four removed packages; it is included in the diff.
- `pnpm install`, `pnpm run typecheck`, and the frontend build (`pnpm --filter @workspace/it-task-manager run build`) all succeed with no reference to any removed catalog entry or package.
- No `@replit/*` reference remains anywhere in the repo **except** `@workspace/replit-auth-web` (a workspace package name — out of scope here) and the `artifacts/api-server/src/lib/auth.ts` `replit_oidc` auth code (out of scope here). A repo-wide search for `@replit/vite-plugin`, `@replit/connectors-sdk`, `REPL_ID` in `vite.config.ts`, and the `.replit`/`replit.md`/`replit.nix` files returns nothing.

## Relevant Files / Paths

- `.replit` — delete (repo root Replit config: `[deployment]` autoscale, three validation `[workflows]`, `[userenv.shared] AUTH_MODE = "replit_oidc"`). Off Replit this file is inert; `AUTH_MODE` already defaults to `local` in code.
- `replit.md`, `replit.nix` — delete (repo root).
- `package.json` (root) — remove `@replit/connectors-sdk` from `dependencies` (line ~19).
- `artifacts/it-task-manager/vite.config.ts` — remove the `REPL_ID`-gated plugin block (the `...(process.env.NODE_ENV !== 'production' && !!process.env.REPL_ID?.trim() ? [ ... ] : [])` spread near the end of the `plugins` array).
- `artifacts/it-task-manager/package.json` — remove the three `@replit/vite-plugin-*` devDependencies (lines ~46–48).
- `pnpm-workspace.yaml` — remove the three `@replit/vite-plugin-*` catalog entries and the two `minimumReleaseAgeExclude` entries (`'@replit/*'`, `stripe-replit-sync`); keep `minimumReleaseAge` + its SECURITY comment.
- `pnpm-lock.yaml` — regenerated by `pnpm install`, committed.

## Standards to Follow

- **American English** in any comment, message, or identifier you touch (`.agents/memory/american-spellings.md`).
- **Regenerate and commit the lockfile** whenever dependencies change — run `pnpm install` so `pnpm-lock.yaml` matches `package.json` / `pnpm-workspace.yaml` (Off-Replit roadmap cross-cutting standard).
- **Don't touch the api-server build/bundle strategy** — this task doesn't need to, and the esbuild bundling of the api-server (with `@google-cloud/*` externalized) must not be altered to "clean up" anything (`.agents/memory/api-server-build-quirks.md`).
- No schema changes here, so the post-merge schema-push procedure does not apply.

## Out of Scope

Do NOT change any of the following — each is owned by a later plan or is a deliberate keep:

- **`ReplitStorageProvider`**, its factory/startup branches, its tests, `STORAGE_DRIVER=replit`, and the `@google-cloud/*` dependency — **Plan 04**. Leave all storage code and the `STORAGE_DRIVER … replit` doc rows in `LOCAL_DEV.md` alone.
- **`replit_oidc` auth mode** in `artifacts/api-server/src/lib/auth.ts` (the `AuthMode` union, `parseAuthMode`, `isOidcAuthMode`, `REPL_ID`/`ISSUER_URL` usage) and the **`@workspace/replit-auth-web`** workspace package (including its `workspace:*` entry in `artifacts/it-task-manager/package.json`) — **Plan 05**. Do not rename the package or remove any auth code. Leave the `AUTH_MODE=replit_oidc` / `REPL_ID` examples in `LOCAL_DEV.md` and `SELF_HOSTING.md` alone.
- **A deploy/release pipeline** to replace the deleted `[deployment]` autoscale config — **Plan 06**. Do not add Docker/registry/deploy workflows here.
- The **esbuild platform-exclusion `overrides`** in `pnpm-workspace.yaml` and their `# replit uses linux-x64 only…` comment — leave as-is (functional platform pruning, not a Replit dependency; editing it just adds noise).
- The passing `.github/workflows/ci.yml` — do not modify it (Plan 02 already ported CI).
- Files under `task-review/` — leave alone.
- Do not reformat, reorder, or "tidy" unrelated parts of the files you edit — keep the diff scoped to the removals above.
