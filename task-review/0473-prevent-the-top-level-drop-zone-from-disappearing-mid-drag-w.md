# #473 — Prevent the top-level drop zone from disappearing mid-drag when the pointer briefly leaves a node

**State:** PROPOSED
**Depends on:** #468

---

# Prevent the top-level drop zone from disappearing mid-drag when the pointer briefly leaves a node

## What & Why
The "Top Level" drop zone is shown only while `dragState != null`. Because dragState is cleared on `dragEnd`, there is a known browser quirk where `dragEnd` fires before `drop` on some browsers, which can cause the drop zone to vanish before the user releases the mouse. A drag-counter or a `dragEnd`-deferred clear would make the UX robust across browsers.

## Done looks like
- The drop zone remains visible until the drag gesture fully ends
- Dropping on the zone reliably triggers the remove-edge call on Chrome, Firefox, and Safari

## Relevant files
- `artifacts/it-task-manager/src/components/ui/task-tree-visualization.tsx`
