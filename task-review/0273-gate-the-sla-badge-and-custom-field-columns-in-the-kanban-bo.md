# #273 — Gate the SLA badge and custom-field columns in the kanban board view

**State:** PROPOSED
**Depends on:** #181

---

# Gate the SLA badge and custom-field columns in the kanban board view

## What & Why
Task #181 gated SLA badges and custom-field rows in the task list and task detail pages, but the kanban board (`KanbanBoard`) still renders SLA badges on cards unconditionally. A user whose org has `sla_tracking` disabled should not see SLA indicators anywhere in the app — including the board view.

## Done looks like
- `SlaBadge` inside `artifacts/it-task-manager/src/components/ui/kanban-board.tsx` is wrapped with `<FeatureGate feature="sla_tracking" compact>`
- Custom-field display (if any) in kanban card is also wrapped with `<FeatureGate feature="custom_fields" compact>`
- No regressions in existing kanban tests

## Relevant files
- `artifacts/it-task-manager/src/components/ui/kanban-board.tsx`
- `artifacts/it-task-manager/src/components/ui/feature-gate.tsx`
