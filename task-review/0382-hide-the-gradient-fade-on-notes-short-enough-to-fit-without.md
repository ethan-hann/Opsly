# #382 — Hide the gradient fade on notes short enough to fit without scrolling

**State:** PROPOSED
**Depends on:** #374

---

# Hide the gradient fade on notes short enough to fit without scrolling

## What & Why
The gradient overlay on the inline note preview is always rendered, even when the note content is short and fits entirely within the clamped height. This creates a misleading visual that suggests more content is hidden when there isn't any.

## Done looks like
- The gradient fade only appears when the rendered note content actually overflows the clamp height
- Short notes render without the gradient, giving users an accurate signal about whether there is hidden content
- Behaviour can be detected via a ResizeObserver or by comparing the element's scrollHeight vs clientHeight

## Relevant files
- artifacts/it-task-manager/src/components/notes/inline-notes.tsx (the note-preview-clamp container and its gradient sibling)
- artifacts/it-task-manager/src/components/notes/inline-notes.test.tsx (update the truncation tests once the conditional is in place)
