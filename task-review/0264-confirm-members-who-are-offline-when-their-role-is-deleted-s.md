# #264 — Confirm members who are offline when their role is deleted still get notified on reconnect

**State:** PROPOSED
**Depends on:** #152

---

# Confirm offline members get notified on reconnect after role deletion

## What & Why
The SSE push fires immediately after DELETE /roles/:id, so any member whose tab
is closed or whose connection is idle at that moment gets no notification. The
OrgGuard has a 60-second fallback poll, but a member could also reconnect after
a longer absence. This should be confirmed with a test against the reconnect /
poll path, not just the hot-path SSE case.

## Done looks like
- A unit or integration test verifying that a member who re-opens the app after
  their role was deleted receives updated permissions within the next poll cycle
  (i.e. the org-context endpoint reflects the new roleId after reassignment, not
  the deleted one)
- Relevant: artifacts/api-server/src/routes/orgs.ts GET /orgs/me handler
  (returns roleName, permissions from current member row)
- artifacts/it-task-manager/src/hooks/org-guard.tsx (60-second poll at line 39)
