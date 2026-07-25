# #263 — Show watcher avatars on Kanban cards so at-risk tasks are visible without switching views

**State:** PROPOSED
**Depends on:** #138

---

# Watcher avatar stack on Kanban cards

## What & Why
The avatar stack on task detail is great for deep work, but the Kanban board is where
teams triage. A compact avatar stack (2–3 max) on each Kanban card gives the same
coordination signal in the board view without requiring a click-through.

## Done looks like
- Kanban cards show up to 2 watcher avatar initials when watchers > 0
- No popover on card (clicking the card still navigates to task detail)
- Reuses the extractable WatcherAvatarStack component from task-detail.tsx

## Relevant files
- artifacts/it-task-manager/src/components/ui/kanban-board.tsx — KanbanCard component
- artifacts/it-task-manager/src/hooks/use-task-watchers.ts — WatcherInfo type
