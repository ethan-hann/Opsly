# #414 — Show a pending-sync indicator on task cards saved while offline so users know changes are queued

**State:** PROPOSED
**Depends on:** #400

---

# Show a visual indicator on task cards saved while offline

## What & Why
When a user creates or updates a task while offline, the action is silently accepted into the queue, but nothing in the UI distinguishes that card from one that was successfully saved. A subtle pending-sync badge would make the offline state transparent and reduce confusion.

## Done looks like
- Task cards with a corresponding pending queue entry show a small sync-pending icon or muted style
- The indicator clears automatically once the queue is flushed
- Works for task creation, status changes, and comment submissions

## Relevant files
- `artifacts/it-task-manager/src/hooks/use-offline-queue.ts`
- `artifacts/it-task-manager/src/components/offline-banner.tsx`
- `artifacts/it-task-manager/src/components/ui/kanban-board.tsx`
