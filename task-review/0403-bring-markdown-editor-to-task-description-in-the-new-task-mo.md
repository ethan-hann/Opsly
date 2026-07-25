# #403 — Bring markdown editor to task description in the New Task modal

**State:** PROPOSED
**Depends on:** #401

---

# Bring markdown editor to task description in the New Task modal

## What & Why
The Edit Task modal already uses MarkdownEditor for its description field. The New Task modal still uses a plain Textarea, which is inconsistent — users get formatting support when editing but not when creating. The pattern is identical to the project modals that were just updated.

## Done looks like
- `new-task-modal.tsx` replaces its Textarea with MarkdownEditor (same `h-48 border border-input rounded-md overflow-hidden` className, `previewMode="edit"`)
- Dialog width is widened from `sm:max-w-[480px]` to `sm:max-w-[520px]` (matching edit-task-modal)
- No other fields or behavior change

## Relevant files
- `artifacts/it-task-manager/src/components/ui/new-task-modal.tsx`
- `artifacts/it-task-manager/src/components/ui/edit-task-modal.tsx` (reference for the pattern)
