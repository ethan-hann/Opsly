# #418 — Prevent future task-list changes from only applying to one layout mode

**State:** PROPOSED
**Depends on:** #405

---

# Prevent future task-list changes from only applying to one layout mode

## What & Why
The task list/board block (list-vs-board toggle, Add Task button, skeleton, KanbanBoard, and the full task row markup) is copy-pasted almost identically into both the tabbed and stacked layout branches of `project-detail.tsx`. Any future change to the task list — adding a filter bar, a new column, a status badge — must be made in two places and is easy to miss.

## Done looks like
- A local `TasksSection` component (or equivalent) is extracted and used in both the tabbed `<TabsContent value="tasks">` and the stacked `<div className="space-y-4">`
- Both layout modes render identically to what they do today
- No props need to be passed from outside the file — the component can close over the shared state

## Relevant files
- `artifacts/it-task-manager/src/pages/project-detail.tsx` — two near-identical task block repetitions starting around the `isLoadingTasks` conditional
