# #368 — Confirm editing a comment with no userId (legacy row) is blocked for non-admins

**State:** PROPOSED
**Depends on:** #312

---

# Confirm editing a comment with no userId (legacy row) is blocked for non-admins

## What & Why
The DELETE route already has a test for legacy comments (userId = null) — only admins can delete them. The PATCH route performs the same owner check (`comment.userId != null && comment.userId === currentUserId`), meaning a legacy comment with userId = null can never satisfy isOwner. Non-admins should be blocked with 403, but there is no test asserting this for the edit path, leaving a potential silent regression.

## Done looks like
- Test: PATCH /comments/:id where comment.userId is null and caller has no edit_comments → 403
- Test: PATCH /comments/:id where comment.userId is null and caller has edit_comments → 200

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` (PATCH handler, lines ~358-365)
- `artifacts/api-server/src/routes/comments.test.ts`
