# #271 — Confirm the task list and kanban board show stage names instead of raw status IDs on task cards

**State:** PROPOSED
**Depends on:** #268

---

# Confirm task list and kanban board show stage names on task cards

## What & Why
Task #268 confirmed the dashboard's SLA Breached and Attention Required sections
render colored stage-name badges correctly. The main task list page (tasks.tsx)
and the kanban board (kanban-board.tsx) also render StatusBadge on every task
card. No targeted test currently covers those views, so the same numeric-status
regression could silently reappear there.

## Done looks like
- A test for the task list page confirms that when the API returns stageName +
  stageColor on a task, the task card shows the stage name (not a raw number)
- A test for the kanban board makes the same assertion for kanban cards
- Both tests follow the pattern in src/pages/dashboard.test.tsx

## Relevant files
- artifacts/it-task-manager/src/pages/tasks.tsx
- artifacts/it-task-manager/src/components/ui/kanban-board.tsx
- artifacts/it-task-manager/src/components/ui/status-badge.test.tsx (reference)
- artifacts/it-task-manager/src/pages/dashboard.test.tsx (reference pattern)
