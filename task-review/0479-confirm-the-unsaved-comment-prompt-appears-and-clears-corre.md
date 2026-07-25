# #479 — Confirm the unsaved-comment prompt appears and clears correctly in end-to-end navigation

**State:** PROPOSED
**Depends on:** #475

---

# Confirm the unsaved-comment prompt appears and clears correctly in end-to-end navigation

## What & Why

The navigation guard for inline comment and note editors was added in code, but there are no automated tests verifying that it actually fires when expected and stays silent when the editor is empty.

## Done looks like

- A Playwright test opens a task detail page, types in the comment box, then clicks a sidebar link — the "You have unsaved changes" dialog appears
- Clicking "Stay" returns focus to the page with text intact
- Clicking "Leave" navigates away without the dialog reappearing
- When the comment box is empty, navigating away triggers no dialog
- Same scenarios covered for the inline note composer

## Relevant files

- `artifacts/it-task-manager/src/pages/task-detail.tsx`
- `artifacts/it-task-manager/src/components/notes/inline-notes.tsx`
- `artifacts/it-task-manager/src/hooks/use-unsaved-changes-guard.ts`
- `artifacts/it-task-manager/src/components/ui/unsaved-changes-dialog.tsx`
