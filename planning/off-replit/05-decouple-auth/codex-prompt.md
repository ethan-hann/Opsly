# Codex Prompt 05 — Decouple Auth from Replit

## Task

Opsly's authentication supports three modes, selected by the `AUTH_MODE` env var and defaulting to `local` when unset: `replit_oidc`, `oidc`, and `local`. The `replit_oidc` mode is Replit-specific — it hardcodes Replit's OIDC issuer (`https://replit.com/oidc`) and reads Replit's `REPL_ID`/`ISSUER_URL` env vars. The generic `oidc` mode already covers any standard OIDC provider, so `replit_oidc` is redundant now that we're off Replit. Separately, the frontend auth package is named `@workspace/replit-auth-web` even though it exposes a generic `useAuth` hook, so the name is misleading.

Do both of the following in a single, self-contained diff:

1. **Remove the `replit_oidc` auth mode** everywhere, keeping generic `oidc` and `local` (still the default). This is a removal of a redundant mode, **not** an auth redesign — do not change how `oidc` or `local` behave.
2. **Rename the `@workspace/replit-auth-web` package to `@workspace/auth-web`** (directory `lib/replit-auth-web/` → `lib/auth-web/`) across every import site, mock, dependency entry, tsconfig reference, and Dockerfile.

This touches authentication, so keep the diff tight and mechanical. Every `oidc`/`local` code path must be left functionally identical.

---

### Part A — Remove the `replit_oidc` auth mode

#### A1. `artifacts/api-server/src/lib/auth.ts`

- **Line 8** — change the union `export type AuthMode = 'replit_oidc' | 'oidc' | 'local';` to `export type AuthMode = 'oidc' | 'local';`.
- **Line 11** — in `interface OidcAuthConfig`, change `mode: 'replit_oidc' | 'oidc';` to `mode: 'oidc';`.
- **`parseAuthMode()` (around lines 37–43)** — change the guard `if (raw === 'replit_oidc' || raw === 'oidc' || raw === 'local') return raw;` to `if (raw === 'oidc' || raw === 'local') return raw;`, and update the error message so it reads `Expected one of: local, oidc.` (drop `replit_oidc`).
- **`getAuthConfig()` (around lines 57–64)** — delete the entire `if (mode === 'replit_oidc') { … }` block (the one that sets `issuerUrl: process.env.ISSUER_URL ?? 'https://replit.com/oidc'` and `clientId: process.env.REPL_ID ?? ''`). After this, the function is: local early-return, then the final generic-`oidc` config using `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`. Leave that generic block exactly as-is.
- **`isOidcAuthMode()` (around lines 75–77)** — with only `oidc` and `local` left, simplify to a single check: the type guard becomes `export function isOidcAuthMode(mode: AuthMode): mode is 'oidc' { return mode === 'oidc'; }`. Keep the function exported — it is used throughout `routes/auth.ts`.
- **`getOidcAuthConfig()` (around lines 92–101)** — delete the `if (config.mode === 'replit_oidc') { throw new Error('REPL_ID (and optional ISSUER_URL) …'); }` branch. Keep the remaining generic error (`'OIDC_ISSUER_URL and OIDC_CLIENT_ID must be set when AUTH_MODE is oidc'`) as the sole `!config.issuerUrl || !config.clientId` throw.

After these edits there must be **no** remaining reference in this file to `replit_oidc`, `REPL_ID`, `ISSUER_URL`, or `replit.com/oidc`. Do not touch `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, session handling, or any other function.

#### A2. `artifacts/api-server/src/routes/auth.ts` — verify only

This file uses `getAuthMode()`, `isOidcAuthMode()`, and `getAuthMode() !== 'local'` in many handlers, plus `loginMethod: config.mode === 'local' ? 'password' : 'oidc'` in `GET /auth/config`. All of these stay correct once `replit_oidc` is gone (they only ever distinguish oidc-vs-local). **Do not change this file** unless a compile error forces it — there should be none.

#### A3. `artifacts/api-server/src/routes/password-reset.test.ts`

- **Line ~303** — in the test `"returns 400 when AUTH_MODE is not local"`, change `mockState.authMode = "replit_oidc";` to `mockState.authMode = "oidc";`. The test's intent (password reset is rejected for any non-`local` mode) is unchanged; `oidc` is now the representative non-local mode. Leave the surrounding `local`/`oidc` cases (lines ~206, ~216, ~295) alone.

#### A4. `lib/replit-auth-web/src/use-auth.ts` (frontend hook — the package being renamed)

This file also hardcodes `replit_oidc`. It must be fixed as part of removing the mode (do this in the renamed `lib/auth-web/` location — see Part B):

- **Line ~25** — in `interface AuthState`, change `authMode: 'replit_oidc' | 'oidc' | 'local';` to `authMode: 'oidc' | 'local';`.
- **Lines ~43–45** — change the initial state `const [authMode, setAuthMode] = useState<'replit_oidc' | 'oidc' | 'local'>('replit_oidc');` to `useState<'oidc' | 'local'>('oidc')`. (`'oidc'` preserves the current pre-fetch behavior, where `loginMethod` also defaults to `'oidc'`; the real value is overwritten by the `/api/auth/config` response as soon as it resolves.)
- **Line ~55** — in the `fetch('/api/auth/config')` response type, change `mode: 'replit_oidc' | 'oidc' | 'local';` to `mode: 'oidc' | 'local';`.

Leave the rest of the hook (login/logout/password flows) untouched.

---

### Part B — Rename `@workspace/replit-auth-web` → `@workspace/auth-web`

Use `git mv` for the directory move so history is preserved. The package is consumed **as source** (its `package.json` `exports` maps `.` → `./src/index.ts`); there is **no committed `dist/`** to hand-edit, and no per-package build step to run — the declaration output under `dist/` is regenerated by `pnpm run typecheck` (the package is a composite project reference). So the rename is purely: move the directory, change the name string, and update every reference to it.

#### B1. Move the directory and rename the package

- `git mv lib/replit-auth-web lib/auth-web`.
- In `lib/auth-web/package.json`, change `"name": "@workspace/replit-auth-web"` to `"name": "@workspace/auth-web"`. Leave everything else in that file (version, exports, dependencies, peerDependencies) unchanged.

#### B2. Update the workspace dependency

- In `artifacts/it-task-manager/package.json` (line ~59), change the dependency key `"@workspace/replit-auth-web": "workspace:*"` to `"@workspace/auth-web": "workspace:*"`. Keep it in the same place in the dependency list and keep the `workspace:*` version.

#### B3. Update the 9 app-source importers (change the import specifier only)

In each file below, change `from "@workspace/replit-auth-web"` (or the single-quoted form where present) to the same import from `@workspace/auth-web`. These are all `import { useAuth } from …`:

- `artifacts/it-task-manager/src/App.tsx` (line ~9, single quotes)
- `artifacts/it-task-manager/src/components/layout/app-layout.tsx` (line ~28)
- `artifacts/it-task-manager/src/hooks/org-guard.tsx` (line ~9)
- `artifacts/it-task-manager/src/pages/org-settings.tsx` (line ~124)
- `artifacts/it-task-manager/src/pages/org-suspended.tsx` (line ~2)
- `artifacts/it-task-manager/src/pages/login.tsx` (line ~1, single quotes)
- `artifacts/it-task-manager/src/pages/invite-page.tsx` (line ~9)
- `artifacts/it-task-manager/src/pages/tasks.tsx` (line ~68)
- `artifacts/it-task-manager/src/pages/task-detail.tsx` (line ~54)

Preserve each file's existing quote style (some use single quotes, most use double).

#### B4. Update the 5 test mocks

In each file below, change the `vi.mock("@workspace/replit-auth-web", …)` call to `vi.mock("@workspace/auth-web", …)`. Change **only** the module-specifier string — leave the mock factory body untouched:

- `artifacts/it-task-manager/src/hooks/org-guard.suspended.test.tsx` (line ~30)
- `artifacts/it-task-manager/src/pages/export-card.sse.test.tsx` (line ~37)
- `artifacts/it-task-manager/src/pages/tasks.applyView.test.tsx` (line ~56)
- `artifacts/it-task-manager/src/pages/task-detail.test.tsx` (line ~95)
- `artifacts/it-task-manager/src/pages/task-detail.mentions.test.tsx` (line ~44)

#### B5. Update tsconfig project references

- Root `tsconfig.json` (line ~10) — change `"path": "./lib/replit-auth-web"` to `"path": "./lib/auth-web"`.
- `artifacts/it-task-manager/tsconfig.json` (line ~22) — change `"path": "../../lib/replit-auth-web"` to `"path": "../../lib/auth-web"`.

#### B6. Update the Dockerfiles

Change every `lib/replit-auth-web` path segment to `lib/auth-web`:

- `Dockerfile` — line ~36 (`COPY lib/replit-auth-web/package.json ./lib/replit-auth-web/`) and line ~95 (`COPY --from=builder /app/lib/replit-auth-web/package.json ./lib/replit-auth-web/`). Update **both** the source and destination path segments on each line.
- `Dockerfile.local` — line ~24.
- `Dockerfile.frontend` — line ~36.

#### B7. Regenerate the lockfile

Run `pnpm install` so `pnpm-lock.yaml` is regenerated with the new package name / link path (the entries around lines 442–444 and 588 currently reference `replit-auth-web`) and committed as part of the diff. Do not hand-edit `pnpm-lock.yaml`.

---

### Part C — Docs

Only `LOCAL_DEV.md` still documents Replit auth (`SELF_HOSTING.md`, `.env.example`, `.env.production.example`, and the `docker-compose*.yml` files already list only `local`/`oidc` — leave them alone).

In `LOCAL_DEV.md`:

- **Line ~98** — the `AUTH_MODE` row in the "Key variables" table currently has a mangled Description cell: `` | `AUTH_MODE` | `local` | `local` \| `s3`| `oidc` \| `replit_oidc` | ``. Fix the Description cell to read exactly `` `local` \| `oidc` `` (drop the stray `s3` fragment and `replit_oidc`). Keep the `Default` cell as `local`.
- **Line ~99** — the `STORAGE_DRIVER` row's Description cell is likewise mangled with a triplicated, unescaped value: `` | `STORAGE_DRIVER` | `local` | `local` \| `s3`|`local` \| `s3`|`local` \| `s3` | ``. The unescaped `|` characters break the row into extra table columns. Fix the Description cell to read exactly `` `local` \| `s3` `` (a single escaped-pipe pair, so the row has exactly the three columns Variable / Default / Description). Keep the `Default` cell as `local`. This is a doc-only formatting fix (a Copilot reviewer flagged the broken table row on the Plan 04 PR); it changes no storage code or storage behavior.
- **Lines ~119–130** — delete the entire `### Replit OIDC` subsection (its heading and the two fenced code blocks that set `AUTH_MODE=replit_oidc`, `REPL_ID`, and `ISSUER_URL`). Leave the `### Local login (default)` subsection above it and the `### Generic OIDC` subsection below it intact.

---

## Acceptance Criteria

- `artifacts/api-server/src/lib/auth.ts`: `AuthMode` is `'oidc' | 'local'`; `OidcAuthConfig.mode` is `'oidc'`; `parseAuthMode` accepts only `oidc`/`local` (defaulting to `local`) and its error message lists `local, oidc`; the `replit_oidc` branch in `getAuthConfig()` and the `replit_oidc` branch in `getOidcAuthConfig()` are gone; `isOidcAuthMode` returns `mode === 'oidc'`. No `replit_oidc`, `REPL_ID`, `ISSUER_URL`, or `replit.com/oidc` remains in the file. `oidc` and `local` behavior is otherwise unchanged.
- `password-reset.test.ts`'s "not local" test uses `"oidc"` instead of `"replit_oidc"`, and the whole `password-reset` suite still passes.
- The package is named `@workspace/auth-web` and lives at `lib/auth-web/`; `lib/replit-auth-web/` no longer exists. Its `use-auth.ts` no longer references `replit_oidc` (unions are `'oidc' | 'local'`, initial `authMode` state is `'oidc'`).
- All 9 app-source importers and all 5 test mocks import from `@workspace/auth-web`; `artifacts/it-task-manager/package.json` depends on `@workspace/auth-web`; both `tsconfig.json` project references point at `lib/auth-web`; all four Dockerfile references use `lib/auth-web`.
- `LOCAL_DEV.md`'s `AUTH_MODE` row reads `` `local` \| `oidc` ``, its `STORAGE_DRIVER` row's Description reads `` `local` \| `s3` `` (no longer triplicated/column-breaking), and the `### Replit OIDC` subsection is gone; no other section of that file changed. The "Key variables" table renders with clean three-column rows.
- A repo-wide search for `replit_oidc`, `@workspace/replit-auth-web`, and `replit-auth-web` returns **zero** hits outside of `planning/off-replit/**`, `planning/local-password-reset/**`, and `task-review/**` (historical records — do not edit them). `REPL_ID` and the `https://replit.com/oidc` issuer likewise no longer appear in any source, doc, or config file (planning/task-review docs excepted).
- `pnpm-lock.yaml` is regenerated via `pnpm install` and committed.
- `pnpm install`, `pnpm run typecheck`, `pnpm --filter @workspace/api-server run build`, `pnpm --filter @workspace/api-server run smoke` (api-server boot check), `pnpm --filter @workspace/it-task-manager run build` (frontend build), `pnpm --filter @workspace/api-server run test:coverage`, and `pnpm --filter @workspace/it-task-manager run test:coverage` (or the repo's frontend test command) all succeed.

## Relevant Files / Paths

**Auth-mode removal:**
- `artifacts/api-server/src/lib/auth.ts` — the union, `OidcAuthConfig.mode`, `parseAuthMode`, the `replit_oidc` branch in `getAuthConfig`, `isOidcAuthMode`, and the `replit_oidc` branch in `getOidcAuthConfig`.
- `artifacts/api-server/src/routes/auth.ts` — **read to confirm** it still compiles; expected to need no change.
- `artifacts/api-server/src/routes/password-reset.test.ts` — line ~303.
- `lib/auth-web/src/use-auth.ts` (post-rename path) — three `replit_oidc` references (lines ~25, ~43–45, ~55).

**Package rename:**
- `lib/replit-auth-web/` → `lib/auth-web/` (dir move via `git mv`), `lib/auth-web/package.json` (`name`).
- `artifacts/it-task-manager/package.json` — dependency key (line ~59).
- App importers: `App.tsx`, `components/layout/app-layout.tsx`, `hooks/org-guard.tsx`, `pages/org-settings.tsx`, `pages/org-suspended.tsx`, `pages/login.tsx`, `pages/invite-page.tsx`, `pages/tasks.tsx`, `pages/task-detail.tsx` (all under `artifacts/it-task-manager/src/`).
- Test mocks: `hooks/org-guard.suspended.test.tsx`, `pages/export-card.sse.test.tsx`, `pages/tasks.applyView.test.tsx`, `pages/task-detail.test.tsx`, `pages/task-detail.mentions.test.tsx`.
- `tsconfig.json` (root, line ~10), `artifacts/it-task-manager/tsconfig.json` (line ~22).
- `Dockerfile` (lines ~36, ~95), `Dockerfile.local` (line ~24), `Dockerfile.frontend` (line ~36).
- `pnpm-lock.yaml` — regenerated by `pnpm install`.

**Docs:**
- `LOCAL_DEV.md` — `AUTH_MODE` table row (line ~98), `STORAGE_DRIVER` table row (line ~99, formatting-only fix), and `### Replit OIDC` subsection (lines ~119–130).

> Line numbers are from a snapshot and may drift slightly — locate by content. There is intentionally **no `dist/` step**: the package exports source directly and has no committed build output.

## Standards to Follow

- **American English** in every comment, message, doc, and identifier you touch (`.agents/memory/american-spellings.md`).
- **Regenerate and commit the lockfile** whenever the workspace graph changes — run `pnpm install` after the package rename so `pnpm-lock.yaml` matches (Off-Replit roadmap cross-cutting standard).
- **api-server esbuild quirk** (`.agents/memory/api-server-build-quirks.md`): the server is bundled by esbuild; `auth.ts` is part of that bundle and is rebuilt by the build — do not hand-edit any `dist/` output. No change to the bundle/externalization strategy is needed here.
- **No schema changes**, so the post-merge schema-push procedure does not apply.
- Keep the diff mechanical and scoped — this is a rename plus removal of one redundant enum value. Do not reformat, reorder imports, or "tidy" the files you touch beyond the specified edits.

## Out of Scope

Do NOT change any of the following:

- **Auth behavior for `oidc` or `local`** — session handling, cookie logic, the OIDC discovery/login/callback/logout flow in `routes/auth.ts`, or the local password-login flow. This task removes a redundant mode and renames a package; it does not redesign auth.
- **The `local` auth / password-reset feature** — tracked separately in `planning/local-password-reset/`. Only the one `replit_oidc → oidc` line in `password-reset.test.ts` changes here; do not touch the reset flow itself.
- **`SELF_HOSTING.md`, `.env.example`, `.env.production.example`, `docker-compose.yml`, `docker-compose.local.yml`** — already free of `replit_oidc`; leave them as-is.
- **The storage layer / storage code** — `artifacts/api-server/src/lib/storage/**`, storage env vars, S3 config, etc. are Plan 04's territory and must not change. The **only** storage-related edit permitted here is the doc-formatting fix to the `STORAGE_DRIVER` **row** in `LOCAL_DEV.md`'s table (Part C) — a broken-markdown cleanup Copilot flagged, changing no behavior. Do not otherwise touch storage docs (e.g. `SELF_HOSTING.md`'s storage sections, the "Storage" prose in `LOCAL_DEV.md`).
- **A deploy/release pipeline** — Plan 06.
- **Historical records** under `planning/**` and `task-review/**` — do not edit them to scrub Replit mentions.
- The `useAuth` hook's public surface beyond the `authMode` type narrowing — keep `AuthUser`, `loginMethod`, `login`, `loginWithPassword`, `logout`, and the `index.ts` re-exports exactly as they are.
