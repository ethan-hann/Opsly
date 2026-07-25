# #483 — Confirm re-parenting a task with multiple parents moves only the dragged edge

**State:** PROPOSED
**Depends on:** #476

---

# Confirm re-parenting a task with multiple parents moves only the dragged edge

## What & Why

The task tree supports DAG structures (a task can have more than one parent). When a child node that participates in two parent edges is dragged from one of those parents to a new target, only that one edge should move — the other parent edge must remain intact. There is currently no test for this scenario, so a regression could silently corrupt multi-parent trees.

## Done looks like

- A vitest test sets up a DAG: task C has two parents (A and B), and task D is a root
- Drag the C node that is rendered under A onto D
- Confirms onMoveDependency is called with (C, A, D)
- Confirms the C-under-B branch is unchanged in the rendered tree
- Confirms C-under-D appears in the new position

## Relevant files

- `artifacts/it-task-manager/src/components/ui/task-tree-dnd.test.tsx`
- `artifacts/it-task-manager/src/components/ui/task-tree-visualization.tsx`
- `artifacts/it-task-manager/src/components/ui/task-tree-node.tsx`
