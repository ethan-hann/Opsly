# #290 — Confirm the server refuses to start when storage variables are missing — not just logs the error

**State:** PROPOSED
**Depends on:** #284

---

# Test that initStorageProvider() exits with code 1 on misconfiguration

## What & Why
`initStorageProvider()` in `artifacts/api-server/src/lib/storage/provider.ts` logs a FATAL message and calls `process.exit(1)` when required storage env vars are absent. There are no tests verifying this behavior. A future refactor that accidentally swaps the exit call for a warning, or removes the validation, would silently break the boot-time guard — operators would be back to discovering misconfiguration only when the first export is attempted.

## Done looks like
A new describe block in the api-server test suite (e.g. `storage/provider.test.ts`) that:
1. Mocks `process.exit` via `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called') })`.
2. For STORAGE_DRIVER=s3: sets each required var missing in turn, calls `initStorageProvider()`, and asserts `process.exit` was called with `1` and the FATAL log contained the missing var name as `"missing"`.
3. For STORAGE_DRIVER=replit: same pattern for `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.
4. Positive control: with all vars set (using a mock provider that doesn't actually connect), asserts `process.exit` was NOT called and an INFO log line was emitted.

## Relevant files
- `artifacts/api-server/src/lib/storage/provider.ts` — `initStorageProvider()`
- `artifacts/api-server/src/lib/logger.ts` — logger to spy on for FATAL assertions
