# #355 — Confirm a soft-deleted parent comment still blocks a new reply targeting it

**State:** PROPOSED
**Depends on:** #307

---

# Confirm a soft-deleted parent comment still blocks a new reply targeting it

## What & Why
The parentId validation queries commentsTable without filtering on deletedAt, so a soft-deleted comment can still be used as a valid parent. It's worth confirming the intended behavior — either the route should reject replies to deleted parents (404) or the test should document that it is allowed.

## Done looks like
- A test POSTs a reply where the parentId refers to a soft-deleted comment (deletedAt set)
- The test asserts the expected status (404 if rejected, 201 if allowed) and documents the design decision in a comment

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` — parentId validation block (lines 167-186)
- `artifacts/api-server/src/routes/comments.test.ts` — POST describe block
