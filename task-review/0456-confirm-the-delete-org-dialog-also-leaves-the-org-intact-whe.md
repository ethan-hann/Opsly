# #456 — Confirm the delete-org dialog also leaves the org intact when Cancel is clicked

**State:** PROPOSED
**Depends on:** #441

---

# Confirm the delete-org dialog also leaves the org intact when Cancel is clicked

## What & Why
AdminOrgsTab has a second confirmation dialog for permanent org deletion (the trash-button flow). The same Cancel path exists but has no test — a regression could cause Cancel to accidentally fire the delete mutation.

## Done looks like
- A test clicks the trash button on an active org to open the delete dialog.
- Clicks Cancel and asserts `deleteMutation.mutate` was not called and the org row is still present.

## Relevant files
- `artifacts/it-task-manager/src/pages/admin/orgs-tab.tsx` — delete dialog (lines 209–229)
- `artifacts/it-task-manager/src/pages/admin/orgs-tab.suspend-cancel.test.tsx` — AlertDialog context mock and scaffolding to reuse
