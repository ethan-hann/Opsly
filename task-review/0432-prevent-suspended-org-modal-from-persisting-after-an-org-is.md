# #432 — Prevent suspended-org modal from persisting after an org is unsuspended mid-session

**State:** PROPOSED
**Depends on:** #430

---

# Prevent suspended-org modal from persisting after an org is unsuspended mid-session

## What & Why
Once the `isSuspendedMidSession` flag is set to true in OrgGuard, the modal stays open permanently for the lifetime of the React tree — even if an admin unsuspends the org. Users would need a full page refresh to recover. Adding a polling-based check (or SSE event) that clears the flag when the org becomes active again would let the UI self-heal without forcing a reload.

## Done looks like
- If the org is unsuspended while the modal is showing, the modal closes automatically within the next polling cycle (≤ 60 s) or immediately on an SSE event.
- The existing 60-second org refetch in OrgGuard, combined with re-checking `org.isDisabled`, is the minimum viable path; an SSE approach is preferred.
- A test confirms the modal disappears when the suspension is lifted.

## Relevant files
- `artifacts/it-task-manager/src/hooks/org-guard.tsx`
- `artifacts/it-task-manager/src/hooks/org-guard.suspended.test.tsx`
