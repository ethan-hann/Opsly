# #288 — Confirm the scheduled cleanup actually deletes storage objects when export TTLs expire — not just the DB rows

**State:** PROPOSED
**Depends on:** #282

---

# Confirm the scheduled cleanup deletes storage objects when export TTLs expire

## What & Why
`export.ts` runs a `setInterval` every 10 minutes that finds expired jobs, calls `storage.delete(objectKey)`, and marks rows as "expired". There is no test that fires this interval, verifies `storage.delete` is called for each expired row, and confirms rows are subsequently marked expired. Without this coverage, a regression (e.g. the cleanup accidentally skipping the storage delete, or the wrong WHERE clause) would silently accumulate orphaned storage objects with no observable test failure.

## Done looks like
- A new `describe` block in `artifacts/api-server/src/routes/export.test.ts` that:
  1. Queues mock DB rows whose `expiresAt` is in the past and status is "pending" or "complete".
  2. Advances fake timers past 10 minutes so the setInterval fires.
  3. Asserts `mockStorageProvider.delete` was called once per expired row with the correct `objectKey`.
  4. (Optionally) queues a second SELECT to confirm the DB update to "expired" would have been called.
- A negative control: rows whose TTL has not elapsed must not have their storage object deleted.

## Relevant files
- `artifacts/api-server/src/routes/export.ts` — cleanup setInterval starting at line ~251
- `artifacts/api-server/src/routes/export.test.ts` — add to the existing test suite
