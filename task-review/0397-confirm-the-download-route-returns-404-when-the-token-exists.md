# #397 — Confirm the download route returns 404 when the token exists but storage has already been deleted

**State:** PROPOSED
**Depends on:** #396

---

# Confirm the download route returns 404 when the token exists but storage has already been deleted

## What & Why
GET /export/download/:token has three early-exit 404 cases (no DB row, wrong status, expired), all now tested. There is a fourth: the DB row is valid (status=complete, not expired) but storage.get() returns null — meaning the object was deleted between the job completing and the download being requested (e.g. by a manual audit run or a storage provider error). The route handles this with a 404 (lines ~595-597 in export.ts), but no test covers it.

## Done looks like
- A test queues a valid complete non-expired DB row, then sets the storage mock to return `null` for `get()`
- GET /export/download/:token returns 404
- The storage mock is restored to its default after the test

## Relevant files
- `artifacts/api-server/src/routes/export.isolation.test.ts` — add inside the "GET /export/download/:token — org isolation" describe block
- `artifacts/api-server/src/routes/export.ts` — lines ~591–598 (the storage.get null check)
- The storage mock is at line ~122 of the test file: `get: vi.fn().mockResolvedValue(Buffer.from(...))`; override with `mockResolvedValueOnce(null)`
