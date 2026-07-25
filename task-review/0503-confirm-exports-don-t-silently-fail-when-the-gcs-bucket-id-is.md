# #503 — Confirm exports don't silently fail when the GCS bucket ID is missing at startup

**State:** PROPOSED
**Depends on:** #495

---

# Confirm exports don't silently fail when the GCS bucket ID is missing at startup

## What & Why

`ReplitStorageProvider.file()` calls `getBucketName()` which throws if `DEFAULT_OBJECT_STORAGE_BUCKET_ID` is unset, but `initStorageProvider` in `provider.ts` already validates required env vars before constructing the driver. There is no test confirming that the replit driver path in `initStorageProvider` correctly rejects (exits/throws) when the bucket ID is absent. A missing bucket silently breaks all exports for Replit-hosted users.

## Done looks like

- `provider.test.ts` covers the STORAGE_DRIVER=replit path: missing DEFAULT_OBJECT_STORAGE_BUCKET_ID causes initStorageProvider to call process.exit(1) with an informative message
- Test uses the same spy/mock pattern already in provider.test.ts

## Relevant files

- `artifacts/api-server/src/lib/storage/provider.ts` — initStorageProvider validation logic
- `artifacts/api-server/src/lib/storage/provider.test.ts` — existing tests (currently failing on local-driver path; fix those too)
- `artifacts/api-server/src/lib/storage/replit.ts` — getBucketName()
