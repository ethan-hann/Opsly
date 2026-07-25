# #343 — Confirm thread collapse hides replies and the reply box, then restores them on expand

**State:** PROPOSED
**Depends on:** #341

---

# Confirm thread collapse hides replies and the reply box, then restores them on expand

## What & Why
The new root-level collapse toggle in `CommentNodeRenderer` is untested. A regression here would silently break the collapse/expand flow for all threaded comments on task detail.

## Done looks like
- A Playwright test opens a task with at least one threaded comment
- Verifies the "N replies" toggle is visible and clicking it hides the child comments
- Verifies the "— N replies hidden —" affordance appears
- Clicking the affordance restores the children
- The inline reply box is also hidden while collapsed

## Relevant files
- `artifacts/it-task-manager/src/pages/task-detail.tsx` — `CommentNodeRenderer` component (rootCollapsed state, depth-0 toggle)
