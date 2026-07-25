# #484 — Prevent the tree from showing a stale structure if re-parenting fails on the server

**State:** PROPOSED
**Depends on:** #476

---

# Prevent the tree from showing a stale structure if re-parenting fails on the server

## What & Why

The ControlledTree wrapper in the UI applies an optimistic edge update immediately when onMoveDependency fires, before the server confirms the change. If the API call fails (network error, permission error, etc.), the tree stays in the wrong state until the user refreshes. A rollback path would restore the original edge and surface an error toast.

## Done looks like

- onMoveDependency callback receives the old and new parent IDs so it can roll back
- When the API mutation fails, the edge is restored to its previous position without a page refresh
- A toast notification informs the user the move failed
- Covered by a vitest test that simulates a rejected mutation and confirms the tree reverts

## Relevant files

- `artifacts/it-task-manager/src/components/ui/task-tree-visualization.tsx`
- The page/panel that renders TaskTreeVisualization and passes onMoveDependency (search for `onMoveDependency`)
