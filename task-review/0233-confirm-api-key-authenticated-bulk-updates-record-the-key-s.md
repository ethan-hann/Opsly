# #233 — Confirm API-key-authenticated bulk updates record the key's identity in audit events

**State:** PROPOSED
**Depends on:** #106

---

# Confirm API-key-authenticated bulk updates record the key's identity in audit events

## What & Why
The bulk PATCH audit event tests added in this task use session auth (req.user). The `resolveActor` helper also handles API-key auth (actorId = key ID, actorName = "API key: <name>"), but this code path is only exercised by tests for the single-task PATCH route. A regression in the API-key branch of resolveActor would silently store null actor info in every bulk-operation audit event.

## Done looks like
- New tests in the "PATCH /api/tasks/bulk - event emission" describe block in `artifacts/api-server/src/routes/tasks.test.ts`
- Test: bulk PATCH via API key records actorId = keyId and actorName = "API key: <name>" in emitted events
- Reuses the existing `requireOrgOrApiKey` mock; override req.user to undefined and set req.apiKeyId / req.apiKeyName for the API-key scenario

## Relevant files
- `artifacts/api-server/src/routes/tasks.test.ts` — "PATCH /api/tasks/bulk - event emission" block (~line 1567)
- `artifacts/api-server/src/routes/tasks.ts` — `resolveActor` helper (~line 252), bulk PATCH handler (~line 619)
