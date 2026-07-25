# #328 — Prevent "Update this view" from appearing on shared org-wide views the user didn't create

**State:** PROPOSED
**Depends on:** #281

---

# Prevent "Update this view" from appearing on shared org-wide views the user didn't create

## What & Why
The "Update this view" button is already gated on `activeView.createdBy === userId`, so org-wide views created by others are safe. However, admins may want to update any org-wide view regardless of who created it — right now they cannot. Alternatively, the button could appear for admins with a clear "you're editing a shared view" warning.

## Done looks like
- Admins see "Update this view" on org-wide views they don't own (with a visible indicator that it's a shared view being changed)
- Non-admins continue to see the button only on their own views

## Relevant files
- `artifacts/it-task-manager/src/pages/tasks.tsx` — `SaveViewPopover`, the `activeView.createdBy === userId` guard
