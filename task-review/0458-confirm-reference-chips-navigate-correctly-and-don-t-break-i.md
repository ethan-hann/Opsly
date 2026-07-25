# #458 — Confirm # reference chips navigate correctly and don't break inside a comment thread

**State:** PROPOSED
**Depends on:** #453

---

# Confirm # reference chips navigate correctly and don't break inside a comment thread

## What & Why
The reference chip anchors use client-side paths like `/tasks/42` and `/projects/7`. Inside a task detail comment thread these links need to navigate via the router without causing a full page reload or stripping the hash. The existing comment-rendering tests were updated to use `preprocessContent` but there are no end-to-end navigation tests for clicking a reference chip.

## Done looks like
- A test (or playwright spec) that renders a comment containing a `#[task:ID:Title]` token and confirms the chip's href resolves to the correct route
- A test that renders a `#[project:ID:Name]` chip and confirms the project route is reached
- Verify that clicking a chip inside the ReactMarkdown renderer does not trigger a full-page navigation (stays in the SPA)

## Relevant files
- `artifacts/it-task-manager/src/pages/task-detail.mentions.test.tsx`
- `artifacts/it-task-manager/src/lib/comment-utils.ts`
- `artifacts/it-task-manager/src/components/notes/markdown-config.tsx` (link renderer for anchors)
