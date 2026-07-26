# 04 — Remove ReplitStorageProvider

> Part of the [Off-Replit program](../roadmap.md). Depends on **03**. Medium risk — touches the storage factory and its tests.

## Problem / Goal

The storage layer (`artifacts/api-server/src/lib/storage/`) supports three drivers: `local` (default), `s3`, and `replit`. The `replit` driver (`ReplitStorageProvider`, backed by GCS via `DEFAULT_OBJECT_STORAGE_BUCKET_ID`) is only useful on Replit Object Storage. Since `local` is already the default and `s3` covers self-hosted object storage, the `replit` driver can go.

## Scope

**In scope — remove the `replit` storage driver:**
- Delete `artifacts/api-server/src/lib/storage/replit.ts` and its test `replit.test.ts`.
- In `provider.ts`, remove the `import { ReplitStorageProvider }`, the `else if (driver === "replit")` branch in `getStorageProvider()`, and the entire `replit` branch in `initStorageProvider()` (the `DEFAULT_OBJECT_STORAGE_BUCKET_ID` validation block). Keep `local` (default) and `s3` intact, including the "unknown driver falls back to local" behavior.
- Update `provider.test.ts` to drop any `STORAGE_DRIVER=replit` cases.
- Update the file's header comment (lines listing the three implementations) to describe only `local` and `s3`.
- Update `artifacts/api-server/SELF_HOSTING.md` — remove the Replit Object Storage sections and any `STORAGE_DRIVER=replit` / `DEFAULT_OBJECT_STORAGE_BUCKET_ID` references from the storage docs.
- Grep for `DEFAULT_OBJECT_STORAGE_BUCKET_ID` and `STORAGE_DRIVER=replit` across the repo (`.env.example`, `.env.production.example`, docs) and remove/adjust remaining references.

**Out of scope:**
- The `@google-cloud/storage` dependency — it may still be used by the `s3`/other code paths or transitively; do NOT remove it as part of this plan unless confirmed fully unused (likely a separate check). Note it as a possible later cleanup.
- Auth changes → **Plan 05**.

## Open Questions / Risks

- **`@google-cloud/storage` after removal.** `ReplitStorageProvider` is the obvious consumer of `@google-cloud/storage`. Once it's gone, that dependency (the very thing pulling in the `gaxios`/`uuid` chain from Plan 01) may be fully removable from `artifacts/api-server/package.json` — which would also make the Plan 01 uuid-override workaround less load-bearing. **Verify** whether anything else imports `@google-cloud/*` before deciding; if nothing does, removing it is a valuable follow-up (possibly folded into this plan if confirmed clean). Flag for Ethan.
- **Data migration.** Any instance currently running `STORAGE_DRIVER=replit` would need to migrate its objects to `local`/`s3` before upgrading. Since we're self-hosting fresh, this likely doesn't apply — confirm no production instance relies on the Replit bucket.
- **Test singleton pattern.** `provider.ts` exposes `_resetStorageProviderForTesting()`; ensure removed test cases don't leave dangling references and the singleton reset still behaves.

## Codex prompt

Generated when this plan reaches the top of the queue (after 03 lands).
