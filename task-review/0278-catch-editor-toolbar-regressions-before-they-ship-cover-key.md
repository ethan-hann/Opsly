# #278 — Catch editor toolbar regressions before they ship — cover key insertion behaviors

**State:** PROPOSED
**Depends on:** #220

---

# Catch editor toolbar regressions before they ship — cover key insertion behaviors

## What & Why
The enriched toolbar has ~20 toolbar actions, cursor-placement logic, keyboard shortcuts, and a Find & Replace engine — none of which have automated tests. A typo in one of the helpers (e.g. indentLine, insertCodeBlock, insertTable) can silently break user workflows.

## Done looks like
Tests (vitest + @testing-library/react) cover at minimum:
- Code block insertion places cursor on the blank line between fences for several language choices
- Table insertion selects "Cell" text in the first data cell
- Callout insertion places cursor after the `> ` prefix
- Indent / Outdent add and remove two leading spaces correctly
- Keyboard shortcuts: Ctrl+B wraps selection in `**`, Ctrl+K inserts link, Shift+Tab outdents
- Find & Replace: match cycling via Prev/Next, Replace, Replace All
- Find & Replace bar opens with Ctrl+H and closes with Escape

## Relevant files
- `artifacts/it-task-manager/src/components/notes/markdown-editor.tsx`
- `artifacts/it-task-manager/src/components/notes/` (new test file)
