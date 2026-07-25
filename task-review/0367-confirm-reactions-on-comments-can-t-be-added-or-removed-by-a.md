# #367 — Confirm reactions on comments can't be added or removed by a different org's user

**State:** PROPOSED
**Depends on:** #312

---

# Confirm reactions on comments can't be added or removed by a different org's user

## What & Why
The PATCH /comments/:id route now has tests confirming org isolation for edits, but the POST /comments/:id/reactions and DELETE /comments/:id/reactions routes perform a similar org-scoped lookup. There are currently no tests verifying that a caller from org B cannot add or remove reactions on a comment belonging to org A. A missing or broken check here would let cross-org data be silently modified.

## Done looks like
- Test: POST /comments/:id/reactions from a different org → 404
- Test: DELETE /comments/:id/reactions from a different org → 404
- Tests run in the existing comments.test.ts mock harness, no live DB required

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` (AddReaction and DeleteReaction route handlers)
- `artifacts/api-server/src/routes/comments.test.ts`
