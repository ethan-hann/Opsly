# #222 — Confirm watcher webhook events include correct payload fields in end-to-end delivery

**State:** PROPOSED
**Depends on:** #79

---

# Confirm watcher webhook events include correct payload fields in end-to-end delivery

## What & Why
The dispatcher functions `dispatchWatcherAdded` and `dispatchWatcherRemoved` are unit-tested for whether they fire, but the payload shape (task id, orgTaskNumber, projectId, watcher userId and email) is not validated end-to-end against a real POST body. A regression in payload construction would be silent.

## Done looks like
- A test exercises the dispatcher with known inputs and captures the JSON body posted to the webhook endpoint
- The test asserts the body contains `task.id`, `task.orgTaskNumber`, `task.projectId`, `watcher.userId`, and `watcher.email`

## Relevant files
- `artifacts/api-server/src/lib/webhook-dispatcher.ts`
- `artifacts/api-server/src/routes/tasks.ts` (watch/unwatch handlers)
