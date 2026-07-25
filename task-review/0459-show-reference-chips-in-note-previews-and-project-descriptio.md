# #459 — Show # reference chips in note previews and project descriptions

**State:** PROPOSED
**Depends on:** #453

---

# Show # reference chips in note previews and project descriptions

## What & Why
The `preprocessContent` function (which processes both @mentions and #references) was wired into task comment rendering (`task-detail.tsx`), but the `MarkdownPreview` component used for notes, project descriptions, and other standalone markdown surfaces passes content directly to ReactMarkdown without running the preprocessors. This means #[task:...] tokens display as raw text in those surfaces.

## Done looks like
- `MarkdownPreview` (or a wrapper call-site) applies `preprocessContent` to its `content` prop before rendering
- Note detail view, inline-notes panel, and project description all render reference chips correctly
- Existing MarkdownPreview tests continue to pass

## Relevant files
- `artifacts/it-task-manager/src/components/notes/markdown-preview.tsx`
- `artifacts/it-task-manager/src/pages/task-detail.tsx` (already updated)
- `artifacts/it-task-manager/src/lib/comment-utils.ts` (`preprocessContent`)
