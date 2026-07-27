# Codex Prompt 04 — Remove ReplitStorageProvider

## Task

Opsly's storage layer (`artifacts/api-server/src/lib/storage/`) supports three drivers selected by the `STORAGE_DRIVER` env var: `local` (default when unset), `s3`, and `replit`. The `replit` driver (`ReplitStorageProvider`, backed by Google Cloud Storage through the Replit sidecar and gated on `DEFAULT_OBJECT_STORAGE_BUCKET_ID`) is only useful on Replit Object Storage. `local` is already the default and `s3` covers self-hosted object storage, so the `replit` driver is dead weight off Replit.

Remove the `replit` driver **and** the now-orphaned Google Cloud dependency chain it was the sole consumer of. This has been verified clean: `artifacts/api-server/src/lib/storage/replit.ts` is the **only** source file importing `@google-cloud/storage`, and `google-auth-library` has **zero** source imports anywhere — both become fully unused once the driver is deleted. This is the confirmed **full-cleanup** scope (the roadmap's deferred `@google-cloud/storage` follow-up, folded into this plan).

Do all of the following in a single, self-contained diff. Keep the `local` (default) and `s3` drivers — including the "unknown driver falls back to local" behavior — completely intact.

### 1. Delete the driver and its test

- Delete `artifacts/api-server/src/lib/storage/replit.ts`.
- Delete `artifacts/api-server/src/lib/storage/replit.test.ts`.

### 2. Strip the `replit` branches from `provider.ts`

In `artifacts/api-server/src/lib/storage/provider.ts`:

- Remove `import { ReplitStorageProvider } from "./replit";` (the import near the top).
- In `getStorageProvider()`, remove the `else if (driver === "replit") { … new ReplitStorageProvider(); }` branch. The `s3` branch and the final `else` (local, default) — including the unknown-driver-falls-back-to-local behavior — must stay exactly as they are.
- In `initStorageProvider()`, remove the **entire** `else if (driver === "replit") { … }` block (the `DEFAULT_OBJECT_STORAGE_BUCKET_ID` validation, the FATAL/WARN/prod-exit logic, and its success `logger.info`). The `s3` branch and the final `else` (local) branch must stay intact and correctly chained (no dangling `else if`/`else`).
- Update the file's header doc comment (the block listing the three concrete implementations) so it describes only `LocalStorageProvider` (default) and `S3StorageProvider`. Remove the `ReplitStorageProvider` line and any `DEFAULT_OBJECT_STORAGE_BUCKET_ID` mention.

### 3. Drop the `replit` cases from `provider.test.ts`

In `artifacts/api-server/src/lib/storage/provider.test.ts`:

- Remove the `vi.mock("@google-cloud/storage", …)` block (it exists only to let `ReplitStorageProvider` construct).
- Remove the `clearReplitEnv()` helper and every call to it in `beforeEach`/`afterEach`.
- Remove the entire `describe("STORAGE_DRIVER=replit", …)` block inside `describe("initStorageProvider", …)` (all three cases: var-present INFO, missing-in-production FATAL/exit, missing-in-development WARN).
- Update the top-of-file doc comment so its "Covered" lists and its description of mocked dependencies no longer mention `replit` / `ReplitStorageProvider` / `@google-cloud/storage`. Keep the `@aws-sdk/client-s3` mock and note.
- Keep all `local`, `s3`, unknown-fallback, and singleton test cases untouched.

### 4. Fix the stale comment in `export.test.ts`

In `artifacts/api-server/src/routes/export.test.ts`, the test `"never deletes keys that list() did not return …"` has a comment that begins "Both storage providers (Replit and S3) now use STORAGE_PREFIX scoping in list()…". Update it to reference the remaining providers — e.g. "The storage providers (Local and S3) use STORAGE_PREFIX scoping in list()…". Do not change the test logic.

### 5. Remove the orphaned Google Cloud dependencies

- In `artifacts/api-server/package.json`, remove **both** `@google-cloud/storage` and `google-auth-library` from `dependencies`. (Verified: neither is imported by any source file once `replit.ts` is gone.) Leave `@aws-sdk/client-s3` and all other dependencies alone.
- In `artifacts/api-server/esbuild.config.mjs`, remove the `"@google-cloud/*",` entry from the `external` array. Leave the surrounding explanatory comment block (it documents the general "unbundleable packages" rationale and explicitly anticipates packages that "may not be imported or installed") and leave the other Google-ish speculative entries (`"@google/*"`, `"googleapis"`) as-is — they were never tied to the Replit driver.

### 6. Relax the uuid override (only if the tree confirms it)

The `pnpm-workspace.yaml` `overrides` block caps `uuid: ">=11.1.1 <13"`. Per its comment, the `<13` cap exists solely because `uuid` 13+ is ESM-only and breaks CommonJS dependents like `gaxios@6`, which reached the tree **through `@google-cloud/storage`**. Removing that dependency may make the cap unnecessary.

After the dependency edits, run `pnpm install`, then verify with `pnpm why uuid` and `pnpm why gaxios` (or `pnpm why -r`):

- **If no CommonJS `uuid` consumer remains** (no `gaxios` / no other package pulling a CJS-only `uuid`), relax the override to `uuid: ">=11.1.1"` — **keep the `>=11.1.1` security floor** (a hard requirement from Plan 01; do not lower or remove it) and drop only the `<13` cap. Update the adjacent comment to explain that the cap was removed because its sole CJS dependent (`gaxios@6` via `@google-cloud/storage`) is gone, while the `>=11.1.1` security floor stays.
- **If any CommonJS `uuid` consumer still remains**, leave `uuid: ">=11.1.1 <13"` and its comment **unchanged**, and say so explicitly in the PR/commit description.

Do not touch the `js-yaml` override or any other entry in the block.

### 7. Update the docs

- **`artifacts/api-server/SELF_HOSTING.md`** — the `### STORAGE_DRIVER=replit (default)` subsection is not only Replit-specific but also **mislabels** `replit` as the default (the real default is `local`). Replace that entire subsection (from its heading through its closing `---`) with a short `### STORAGE_DRIVER=local (default)` subsection in the same style, documenting that export files are written to the local filesystem with no cloud bucket required, its optional vars `LOCAL_STORAGE_PATH` (default `./data/exports`) and `STORAGE_PREFIX` (default `exports/`), and a one-line note that this is the default when `STORAGE_DRIVER` is unset. Leave the `STORAGE_DRIVER=s3` subsection and every other section (Database, Authentication, Email, Server) untouched. No `DEFAULT_OBJECT_STORAGE_BUCKET_ID` or Replit reference may remain in the file.
- **`LOCAL_DEV.md`** — in the "Key variables" table, change the `STORAGE_DRIVER` row's allowed-values cell from `` `local` \| `s3` \| `replit` `` to `` `local` \| `s3` ``. **Leave the auth rows and sections alone** — the `AUTH_MODE` row (which lists `replit_oidc`) and the "Replit OIDC" auth subsection are owned by Plan 05. The "Storage" prose section already mentions only `local` and `s3`; do not touch it.
- **`.agents/memory/export-storage.md`** — remove the `replit.ts` architecture bullet, remove `@google-cloud/storage` and `google-auth-library` from the "Packages added to api-server" list (keep `@aws-sdk/client-s3`), and update the "How to apply" line that says "lazy loading of GCS/S3 SDKs" so it no longer references GCS (e.g. "the S3 SDK"). This keeps the project memory accurate.

### 8. Regenerate the lockfile

Run `pnpm install` so the regenerated `pnpm-lock.yaml` (with `@google-cloud/storage`, `google-auth-library`, and their transitive chain removed) is part of the diff and committed.

## Acceptance Criteria

- `artifacts/api-server/src/lib/storage/replit.ts` and `replit.test.ts` no longer exist.
- `provider.ts` no longer imports or references `ReplitStorageProvider`; `getStorageProvider()` and `initStorageProvider()` handle only `s3` and `local` (default), the unknown-driver-→-local fallback still works, and the `else`/`else if` chains are syntactically valid with no dangling branch. The header comment describes only `local` and `s3`.
- `provider.test.ts` has no `@google-cloud/storage` mock, no `clearReplitEnv`, and no `STORAGE_DRIVER=replit` describe block; the `s3`, `local`, unknown-fallback, and singleton tests still pass.
- `artifacts/api-server/package.json` no longer lists `@google-cloud/storage` or `google-auth-library`.
- `esbuild.config.mjs`'s `external` array no longer contains `"@google-cloud/*"` (and is still a valid array — no trailing-comma/syntax breakage). `"@google/*"` and `"googleapis"` remain.
- `pnpm-workspace.yaml`: the `uuid` override is either relaxed to `>=11.1.1` (with an updated comment) or left as `>=11.1.1 <13` — matching what `pnpm why uuid`/`pnpm why gaxios` show — and the PR/commit description states which and why. The `>=11.1.1` security floor is present either way.
- `SELF_HOSTING.md` documents `local` (default) and `s3` only — no Replit/`DEFAULT_OBJECT_STORAGE_BUCKET_ID` content, and no subsection is mislabeled as the default when it isn't.
- `LOCAL_DEV.md`'s `STORAGE_DRIVER` row reads `` `local` \| `s3` ``; its auth rows/sections are unchanged.
- `.agents/memory/export-storage.md` no longer references `replit.ts`, `@google-cloud/storage`, or `google-auth-library`.
- `pnpm-lock.yaml` is regenerated via `pnpm install` and included in the diff.
- A repo-wide search finds **no** remaining `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `ReplitStorageProvider`, `STORAGE_DRIVER=replit` (or `replit` as a storage-driver value), `@google-cloud/`, or `google-auth-library` reference **outside** of: the `planning/off-replit/**` docs and `task-review/**` (historical records — leave them), and the auth-only Replit surfaces owned by Plan 05 (`replit_oidc`, `REPL_ID`, `ISSUER_URL`, `@workspace/replit-auth-web`, and their `LOCAL_DEV.md`/`SELF_HOSTING.md` examples).
- `pnpm install`, `pnpm run typecheck`, `pnpm --filter @workspace/api-server run build`, `pnpm --filter @workspace/api-server run smoke` (api-server boot check), `pnpm --filter @workspace/it-task-manager run build` (frontend build), and `pnpm --filter @workspace/api-server run test:coverage` (coverage-gated tests) all succeed.

## Relevant Files / Paths

- `artifacts/api-server/src/lib/storage/replit.ts` — delete.
- `artifacts/api-server/src/lib/storage/replit.test.ts` — delete.
- `artifacts/api-server/src/lib/storage/provider.ts` — remove the `ReplitStorageProvider` import, the `replit` factory branch in `getStorageProvider()`, the `replit` validation block in `initStorageProvider()`, and the header-comment line for the driver.
- `artifacts/api-server/src/lib/storage/provider.test.ts` — remove the `@google-cloud/storage` mock, `clearReplitEnv`, the `STORAGE_DRIVER=replit` describe block, and stale doc-comment lines.
- `artifacts/api-server/src/routes/export.test.ts` — fix the "Both storage providers (Replit and S3)" comment (~line 880).
- `artifacts/api-server/package.json` — remove `@google-cloud/storage` and `google-auth-library` from `dependencies`.
- `artifacts/api-server/esbuild.config.mjs` — remove the `"@google-cloud/*"` entry from `external`.
- `pnpm-workspace.yaml` — conditionally relax the `uuid` override (keep the `>=11.1.1` floor).
- `artifacts/api-server/SELF_HOSTING.md` — replace the mislabeled Replit subsection with a `local` (default) subsection.
- `LOCAL_DEV.md` — drop `replit` from the `STORAGE_DRIVER` allowed-values cell only.
- `.agents/memory/export-storage.md` — drop the Replit driver bullet and the two removed packages.
- `pnpm-lock.yaml` — regenerated by `pnpm install`, committed.

## Standards to Follow

- **American English** in every comment, message, doc, and identifier you touch (`.agents/memory/american-spellings.md`).
- **Regenerate and commit the lockfile** whenever dependencies change — run `pnpm install` so `pnpm-lock.yaml` matches `package.json` and `pnpm-workspace.yaml` (Off-Replit roadmap cross-cutting standard).
- **api-server esbuild quirk** (`.agents/memory/api-server-build-quirks.md`): the server is bundled by esbuild from its own `node_modules` with externalized packages. The only externalization change here is deleting the now-dead `"@google-cloud/*"` entry (its package is being removed); do **not** otherwise restructure the `external` list, the bundle format, or the build strategy.
- No schema changes here, so the post-merge schema-push procedure does not apply.
- Keep the diff scoped to the removals/edits above — do not reformat, reorder, or "tidy" unrelated parts of the files you touch.

## Out of Scope

Do NOT change any of the following — each is owned by a later plan or is a deliberate keep:

- **Auth / `replit_oidc`** — the `AuthMode` union, `parseAuthMode`, `isOidcAuthMode`, `REPL_ID`/`ISSUER_URL` usage in `artifacts/api-server/src/lib/auth.ts`, the `@workspace/replit-auth-web` workspace package, and the `AUTH_MODE=replit_oidc` / "Replit OIDC" examples in `LOCAL_DEV.md` and `SELF_HOSTING.md` — **Plan 05**. Leave all of it, including the `AUTH_MODE` table row that lists `replit_oidc`.
- **A deploy/release pipeline** — **Plan 06**.
- The **`local.ts` and `s3.ts` drivers** and their tests — leave untouched; this plan only removes the `replit` driver.
- Files under `task-review/` and `planning/off-replit/` — historical records; do not edit them to "remove Replit mentions."
- The other esbuild `external` entries (`"@google/*"`, `"googleapis"`, and the rest) — leave as-is.
