# 05 — Decouple Auth from Replit

> Part of the [Off-Replit program](../roadmap.md). Depends on **04**. Highest risk — touches authentication. Do this last, as its own carefully-reviewed diff.

## Problem / Goal

Auth already supports three modes (`artifacts/api-server/src/lib/auth.ts`): `replit_oidc`, `oidc`, and `local`, defaulting to `local` when `AUTH_MODE` is unset. The `replit_oidc` mode is Replit-specific (Replit's OIDC issuer). Generic `oidc` already exists and covers any standard OIDC provider, so `replit_oidc` is redundant once we're off Replit. Separately, the frontend auth package is named `@workspace/replit-auth-web` although it exposes a generic `useAuth` hook — the name is now misleading.

## Scope

**In scope:**
- **Drop the `replit_oidc` auth mode** in `artifacts/api-server/src/lib/auth.ts`: remove `'replit_oidc'` from the `AuthMode` / `OidcAuthConfig` unions, its handling in `parseAuthMode()` and anywhere the mode is branched on, keeping generic `'oidc'` and `'local'`. Keep `local` as the default. Update `password-reset.test.ts` and any other test referencing `replit_oidc`.
- **Rename `@workspace/replit-auth-web`** → a neutral name (e.g. `@workspace/auth-web` — confirm with Ethan). This touches:
  - `lib/replit-auth-web/package.json` (`name`), and the directory name `lib/replit-auth-web/`.
  - **9** app-source importers in `artifacts/it-task-manager/src/` (`App.tsx`, `components/layout/app-layout.tsx`, `hooks/org-guard.tsx`, `pages/org-settings.tsx`, `pages/org-suspended.tsx`, `pages/login.tsx`, `pages/invite-page.tsx`, `pages/tasks.tsx`, `pages/task-detail.tsx`) plus **5** `vi.mock("@workspace/replit-auth-web", …)` call sites (`hooks/org-guard.suspended.test.tsx`, `pages/export-card.sse.test.tsx`, `pages/tasks.applyView.test.tsx`, `pages/task-detail.test.tsx`, `pages/task-detail.mentions.test.tsx`). _(The original "~9 importers / two mocks" estimate was low — re-grep in the prompt confirmed 9 + 5.)_
  - `artifacts/it-task-manager/package.json` dependency entry (`workspace:*`).
  - `tsconfig` project references: root `tsconfig.json` and `artifacts/it-task-manager/tsconfig.json`.
  - Dockerfile `COPY` paths: `Dockerfile` (×2), `Dockerfile.local`, `Dockerfile.frontend`.
- Re-run `pnpm install` so the workspace link and `pnpm-lock.yaml` update. **Correction:** the package is consumed as source (`exports` → `./src/index.ts`) with **no committed `dist/`**, so there is nothing to hand-rebuild — `pnpm run typecheck` regenerates the declaration output. Its `src/use-auth.ts` **also** hardcodes `replit_oidc` (type unions + initial state default), so it's part of the mode removal, not just the rename.

**Decided:** neutral name is **`@workspace/auth-web`** (dir `lib/auth-web/`), confirmed 2026-07-27.

**Rider (added 2026-07-27):** while editing the `LOCAL_DEV.md` "Key variables" table for the `AUTH_MODE` row, also fix the adjacent **`STORAGE_DRIVER` row**, whose Description cell is mangled/triplicated (`` `local` \| `s3`|`local` \| `s3`|`local` \| `s3` ``) — a Copilot reviewer flagged it on the Plan 04 PR and it was deferred to now. Doc-formatting only; no storage code or behavior changes, and the storage layer itself stays out of scope.

**Out of scope:**
- Building a *new* auth provider or changing auth behavior — this is a rename + removal of a redundant mode, not an auth redesign.
- The `local` auth / password-reset flow (tracked separately in `planning/local-password-reset/`).

## Open Questions / Risks

- **Confirm no runtime dependency on Replit OIDC.** If any deployed instance authenticates via `replit_oidc`, removing it locks them out until they reconfigure to generic `oidc` or `local`. Since we're self-hosting fresh, confirm the target instances use `local`/`oidc`.
- **Rename blast radius.** The package rename is mechanical but wide (imports, mocks, package.json, dir name, possibly `tsconfig` references and the orval/codegen or build graph). Highest chance of a missed reference — the Codex prompt must enumerate every import site and the diff must be verified with a repo-wide grep for the old name returning zero hits (excluding `dist`/build artifacts, which get regenerated).
- **`dist` artifacts.** `lib/replit-auth-web/dist/` and `artifacts/api-server/dist/` contain compiled references to the old name / `replit_oidc`; ensure they're rebuilt, not hand-edited.
- **Sequencing:** because this is the riskiest step and touches many files, generate its Codex prompt only after 01–04 have landed, and re-grep import sites at that point (they may have shifted).

## Codex prompt

Generated: [codex-prompt.md](codex-prompt.md) (2026-07-27, after 04 landed, with a fresh grep of `replit_oidc` and `@workspace/replit-auth-web` import sites — which surfaced 4 more import sites and the `use-auth.ts` `replit_oidc` hardcoding beyond the plan's original estimate).
