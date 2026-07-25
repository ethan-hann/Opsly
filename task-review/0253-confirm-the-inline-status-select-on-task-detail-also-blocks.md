# #253 — Confirm the inline status select on task detail also blocks closed stages for members without close_tasks

**State:** PROPOSED
**Depends on:** #180

---

# Test the inline status select permission gate on the task detail page

## What & Why
Task #180 added a unit test for the Edit Task modal's status gate, but the
task-detail page also has its own inline status select (in the property panel)
with the same close_tasks gate (artifacts/it-task-manager/src/pages/task-detail.tsx
line ~952). That gate is untested — a regression there could let members set
closed stages from the detail pane without going through the modal.

## Done looks like
- In artifacts/it-task-manager/src/pages/task-detail.test.tsx, add two tests
  under a new describe "TaskDetail — close_tasks inline status gate":
  · "hides closed-type stages from the inline status select when the user lacks
    close_tasks" — verify the closed stage option is absent (hidden: true)
  · "shows the status as a read-only badge when the task is in a closed stage
    and the user lacks close_tasks" — verify no combobox is rendered for status

## Relevant files
- artifacts/it-task-manager/src/pages/task-detail.tsx (lines ~950-973)
- artifacts/it-task-manager/src/pages/task-detail.test.tsx (add to existing file)
- artifacts/it-task-manager/vitest.config.ts
