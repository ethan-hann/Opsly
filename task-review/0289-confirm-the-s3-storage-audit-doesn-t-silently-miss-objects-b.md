# #289 — Confirm the S3 storage audit doesn't silently miss objects beyond the first 1,000 (pagination gap)

**State:** PROPOSED
**Depends on:** #283

---

# Confirm S3 list() correctly pages through large buckets

## What & Why
`S3StorageProvider.list()` uses a paginated `ListObjectsV2Command` loop (following `NextContinuationToken` until `IsTruncated` is false). This is the correct approach, but the pagination path has no test coverage. S3 returns at most 1,000 objects per request, so any bucket with more than 1,000 export objects (possible for large orgs with many historical jobs) would have the audit silently miss everything beyond the first page — orphaned objects beyond page 1 would never be cleaned up.

## Done looks like
- A unit test for `S3StorageProvider.list()` (or for `runStorageAudit` using a mock `list()`) that simulates a paginated response:
  1. First call returns `IsTruncated: true` with 1,000 keys and a `NextContinuationToken`.
  2. Second call (with the token) returns the remaining keys and `IsTruncated: false`.
  3. Assert that all keys from both pages are returned by `list()`.
- A matching audit test confirming that objects from page 2 are also audited (orphaned ones deleted).

## Relevant files
- `artifacts/api-server/src/lib/storage/s3.ts` — `list()` implementation
- `artifacts/api-server/src/routes/export.test.ts` — existing audit test suite to extend
