# #334 — Extend singular terminology to action buttons in modals and detail pages

**State:** PROPOSED
**Depends on:** #302

---

# Extend singular terminology to action buttons in modals and detail pages

## What & Why
The `ts()` helper is now wired up in projects.tsx and tasks.tsx, but modals and detail-page CTAs still have hardcoded English. For example "Create task" inside `new-task-modal.tsx`, "Save task" in edit flows, and project-detail page buttons still say "New Task" regardless of the configured singular term.

## Done looks like
- `new-task-modal.tsx` button label uses `ts("tasks")`
- `edit-task-modal.tsx` button label uses `ts("tasks")`
- `new-project-modal.tsx` button label uses `ts("projects")`
- `project-detail.tsx` "New Task" button uses `ts("tasks")`
- Any other modal or inline CTA that hardcodes a term-key word is updated

## Relevant files
- `artifacts/it-task-manager/src/components/ui/new-task-modal.tsx`
- `artifacts/it-task-manager/src/components/ui/edit-task-modal.tsx`
- `artifacts/it-task-manager/src/components/ui/new-project-modal.tsx`
- `artifacts/it-task-manager/src/pages/project-detail.tsx`
