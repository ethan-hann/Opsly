# #262 — Show the watcher avatar stack on task cards in the list view so teams can see followers without opening a task

**State:** PROPOSED
**Depends on:** #138

---

# Show watcher avatars on task list cards

## What & Why
The avatar stack is now visible on the task detail page. Teams scanning the task list
have no way to see who's watching without clicking into each task. Adding a compact
avatar stack (2–3 max, no popover) to the task list row gives teams at-a-glance
coordination visibility across the board.

## Done looks like
- Each task row in the list view shows up to 3 watcher avatars (or a count badge if 0)
- Clicking an avatar opens the task detail, not a separate popover
- Only shown when watchers > 0 (no visual noise on unwatched tasks)

## Relevant files
- artifacts/it-task-manager/src/pages/tasks.tsx — task list row component
- artifacts/it-task-manager/src/hooks/use-task-watchers.ts — WatcherInfo type
- The WatcherAvatarStack component is defined inline in task-detail.tsx — consider
  extracting it to artifacts/it-task-manager/src/components/ui/watcher-avatar-stack.tsx
  so both pages can share it
