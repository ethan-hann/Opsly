# #252 — Confirm Create Task modal also blocks setting closed stages for members without close_tasks

**State:** PROPOSED
**Depends on:** #179

---

# Confirm Create Task modal blocks closed stages for members without close_tasks

## What & Why
The Edit Task modal now filters out closed-type stages when the user lacks close_tasks. The Create Task modal (if it has a stage/status selector) may have the same gap — a member without close_tasks could create a task directly in a closed stage, bypassing the intent of the permission.

## Done looks like
- Review artifacts/it-task-manager/src/components/ui/create-task-modal.tsx (or equivalent)
- If a status/stage selector exists, apply the same canClose / activeStages filter used in edit-task-modal.tsx
- Verify the selector is absent or read-only for members without close_tasks when a closed-type stage would otherwise appear

## Relevant files
- artifacts/it-task-manager/src/components/ui/edit-task-modal.tsx (reference implementation)
- artifacts/it-task-manager/src/hooks/use-org-context.tsx (hasPermission)
