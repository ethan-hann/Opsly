# #364 — Confirm @[everyone] sends no spurious notification when the commenter is the only org member

**State:** PROPOSED
**Depends on:** #311

---

# Confirm @[everyone] sends no spurious notification when the commenter is the only org member

## What & Why
When the commenter is the sole active member of the org, the @[everyone] branch builds an empty mentionTargets set (the commenter is excluded from self-notification). The guard `if (mentionTargets.size > 0)` prevents calling notifyMentions in this case, but no test covers this edge case against a live database.

## Done looks like
- A live-DB test seeds an org with a single active member (the commenter/actor) and posts a comment containing @[everyone]
- The test asserts notifyMentions is NOT called (empty recipient set)
- The test asserts the comment is still created with 201

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` — the @[everyone] branch and `if (mentionTargets.size > 0)` guard (lines ~264-288)
- `artifacts/api-server/src/routes/comments-everyone-mention-db.test.ts` — the live-DB @everyone test suite; add the new case here
