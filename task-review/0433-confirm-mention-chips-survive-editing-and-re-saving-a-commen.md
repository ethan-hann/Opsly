# #433 — Confirm mention chips survive editing and re-saving a comment

**State:** PROPOSED
**Depends on:** #423

---

# Confirm mention chips survive editing and re-saving a comment

## What & Why
The current tests confirm preprocessMentions() converts tokens to chips on first render, but do not cover the edit flow. When a user edits an existing comment that already contains @[userId:Name] tokens, the MarkdownEditor receives the raw token string, and on save the content is round-tripped through the API and re-rendered. A regression here would silently drop mention chips or show raw @[...] text after an edit.

## Done looks like
- A test that starts with a comment containing a mention, enters edit mode, saves without changes, and confirms chips are still rendered (not raw tokens) after the mutation resolves.
- A test that adds a new mention during editing and confirms it also renders as a chip.

## Relevant files
- `artifacts/it-task-manager/src/pages/task-detail.tsx` — CommentNodeRenderer edit flow (useUpdateComment, editMutation)
- `artifacts/it-task-manager/src/lib/comment-utils.ts` — preprocessMentions()
- `artifacts/it-task-manager/src/pages/task-detail.mentions.test.tsx` — existing mention rendering tests
