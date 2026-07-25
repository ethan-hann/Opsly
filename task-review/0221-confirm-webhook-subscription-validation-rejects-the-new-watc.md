# #221 — Confirm webhook subscription validation rejects the new watcher event types for old API clients

**State:** PROPOSED
**Depends on:** #79

---

# Confirm webhook subscription validation rejects the new watcher event types for old API clients

## What & Why
Two new event types — `task.watcher_added` and `task.watcher_removed` — were added to the outbound webhook event enum. The backend validation schema (`OutboundEventEnum` in `artifacts/api-server/src/routes/webhooks.ts`) must accept them and must reject unknown strings. There are no tests confirming this boundary today.

## Done looks like
- A test confirms that creating or updating a webhook with `"task.watcher_added"` or `"task.watcher_removed"` in the events array returns 201/200
- A test confirms that an unknown event string (e.g. `"task.watcher_bulk_added"`) returns 400

## Relevant files
- `artifacts/api-server/src/routes/webhooks.ts`
- `artifacts/api-server/src/routes/webhooks.test.ts` (if it exists) or the nearest outbound webhook test file
