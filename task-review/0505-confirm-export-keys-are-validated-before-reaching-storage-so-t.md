# #505 — Confirm export keys are validated before reaching storage so traversal attempts surface a clear API error

**State:** PROPOSED
**Depends on:** #496

---

# Confirm export keys are validated before reaching storage so traversal attempts surface a clear API error

## What & Why

`LocalStorageProvider.filePath()` now throws on any `..` segment, but the export route that calls `put()` / `get()` has no guard of its own. If a caller ever supplies a crafted key (e.g. through a DB row containing a bad objectKey), the error will surface as an unhandled 500 rather than a structured 400. Adding a route-level check (or a schema validation on objectKey) makes the contract visible and testable at the API boundary.

## Done looks like

- The export route (or the schema used to create export jobs) validates that objectKey contains no `../` segments
- A test confirms that a tampered objectKey returns 400 rather than 500
- `LocalStorageProvider` remains the authoritative guard, but the route catch is a clear, documented second layer

## Relevant files

- `artifacts/api-server/src/lib/storage/local.ts` — updated guard
- `artifacts/api-server/src/routes/exports.ts` (or equivalent export-job route) — where objectKey originates
- `artifacts/api-server/src/lib/storage/local.test.ts` — existing storage unit tests
