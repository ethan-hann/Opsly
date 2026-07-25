# #481 — Confirm touch-drag still shows visual feedback (highlight + floating label) while the finger moves

**State:** PROPOSED
**Depends on:** #477

---

# Confirm touch-drag still shows visual feedback during the gesture

## What & Why

The touch drag path has two stages: (1) touchstart sets dragState so the drop zone appears, (2) touchmove updates the floating label position and highlights the element under the finger. Stage 2 is the user-facing "dragging" visual — without it the interface looks frozen mid-gesture. The existing tests only confirm the gesture resolves correctly (stage 1 + touchend); the touchmove stage has no coverage.

## Done looks like

- A test dispatches touchstart then a series of touchmove events on the container
- Confirms the floating label div (class "fixed z-50 pointer-events-none") becomes visible and follows the finger (updated coordinates)
- Confirms the drop zone element receives an outline style when the finger passes over it
- Confirms clearing: after touchend the label disappears and the outline is removed

## Relevant files

- `artifacts/it-task-manager/src/components/ui/task-tree-visualization.tsx` (handleTouchMove, clearTouchHighlight)
- `artifacts/it-task-manager/src/components/ui/task-tree-dnd.test.tsx` (add new describe block)
