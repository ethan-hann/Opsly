# #327 — Confirm updating a saved view's filters doesn't clobber its name or visibility settings

**State:** PROPOSED
**Depends on:** #281

---

# Confirm updating a saved view's filters doesn't clobber its name or visibility settings

## What & Why
The new "Update this view" button sends a PATCH with only `filters` in the body. A PATCH handler that does a shallow merge is safe, but if the server merges incorrectly (e.g. resets `isOrgWide` or `name` to defaults), users would silently lose their view's name or sharing setting after updating filters.

## Done looks like
- A test PATCHes a view with only `{ filters: {...} }` and asserts the response still has the original `name` and `isOrgWide` value
- A test PATCHes with `{ name: "new name" }` and asserts `filters` is unchanged

## Relevant files
- `artifacts/api-server/src/routes/views.ts` — PATCH handler
- `artifacts/api-server/src/routes/views.test.ts` (if it exists)
