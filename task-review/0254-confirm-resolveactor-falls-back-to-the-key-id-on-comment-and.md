# #254 — Confirm resolveActor falls back to the key ID on comment and delete routes (not just task create/update)

**State:** PROPOSED
**Depends on:** #182

---

# Extend the apiKeyName fallback test to comment and delete routes

## What & Why
Task #182 confirmed the apiKeyName-absent fallback on POST /tasks, PATCH /tasks/:id,
and PATCH /tasks/bulk. The resolveActor helper is also called by the comment-created
audit path and potentially other routes that emit audit events. If middleware ever
omits apiKeyName on those code paths, "API key: undefined" could appear in comment
or delete audit entries without any failing test.

## Done looks like
- In api-key-audit.test.ts (or a new comments-audit.test.ts), add tests for
  POST /api/tasks/:id/comments and DELETE /api/tasks/:id that assert:
  · actorName uses the key ID as fallback when apiKeyName is absent
  · actorName never contains "undefined"

## Relevant files
- artifacts/api-server/src/routes/api-key-audit.test.ts
- artifacts/api-server/src/routes/tasks.ts — resolveActor (line ~254)
- artifacts/api-server/src/routes/comments.ts — actor attribution for comment events
