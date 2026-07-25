# #371 — Confirm DELETE /comments/:id also lets API key callers remove comments they did not create

**State:** PROPOSED
**Depends on:** #314

---

# Confirm DELETE /comments/:id also lets API key callers remove comments they did not create

## What & Why
The PATCH /comments/:id route now has explicit tests confirming API keys bypass the ownership check via hasPermission() returning true. The DELETE /comments/:id route uses the same hasPermission() pattern for its isAdmin gate, but has no equivalent API-key test. A gap here means a regression in the delete path could go undetected.

## Done looks like
- Test: API key with comments:write scope calling DELETE → 204 on a comment it did not create
- Test: API key calling DELETE on a legacy comment with no userId → 204
- Optionally: confirm that a key without comments:write scope gets 403

## Relevant files
- `artifacts/api-server/src/routes/comments.test.ts` (isApiKey mock pattern already in place)
- `artifacts/api-server/src/routes/comments.ts` (DELETE handler, lines ~407–469)
