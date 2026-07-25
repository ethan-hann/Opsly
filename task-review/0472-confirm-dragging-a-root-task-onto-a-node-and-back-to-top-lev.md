# #472 — Confirm dragging a root task onto a node and back to top level reflects in the tree without a page refresh

**State:** PROPOSED
**Depends on:** #468

---

# Confirm dragging a root task onto a node and back to top level reflects in the tree without a page refresh

## What & Why
Task 468 added drag handles to root nodes and a "Top Level" drop zone. There are no automated or end-to-end tests verifying that:
- Dragging a root task onto another node calls POST /task-dependencies and the tree updates
- Dragging a child task onto the drop zone calls DELETE /task-dependencies and the task reappears as a root
- The invalid-drop guard (no cycles, no self-drop) works for root drags

## Done looks like
- Playwright or vitest tests exercise both drag directions against the live tree in the it-task-manager artifact
- Cycle prevention is confirmed (dragging a parent onto one of its descendants is rejected)

## Relevant files
- `artifacts/it-task-manager/src/components/ui/task-tree-node.tsx`
- `artifacts/it-task-manager/src/components/ui/task-tree-visualization.tsx`
