---
name: Markdown editor theming
description: How @uiw/react-md-editor is themed with the app's warm stone & amber palette, and notes on the removed dock/preview-window system.
---

# @uiw/react-md-editor theming

## Rule
Override the library's GitHub-style CSS variables (`--color-canvas-default`, `--color-border-default`, etc.) from `index.css` using the `[data-color-mode="light"], [data-color-mode="dark"]` combined selector. The app's own vars (`--card`, `--border`, `--primary`, etc.) resolve correctly under both modes because ThemeProvider sets the `.dark` class on `<html>`.

**Why:** The library hard-codes a GitHub theme. Overriding its CSS vars at the `[data-color-mode]` selector level (set on the wrapper div in `MarkdownEditor`) is the only approach that doesn't require forking the package CSS.

**How to apply:** Add or update the `[data-color-mode]` block at the bottom of `index.css`. The MDEditor's box-shadow outer border is stripped (`box-shadow: none !important`) since parent containers provide their own visual edges.

## Key CSS variable mappings (index.css)
- `--color-canvas-default`  → `hsl(var(--card))`
- `--color-canvas-subtle`   → `hsl(var(--muted))`
- `--color-border-default`  → `hsl(var(--border))`
- `--color-fg-default`      → `hsl(var(--foreground))`
- `--color-fg-muted`        → `hsl(var(--muted-foreground))`
- `--color-neutral-muted`   → `hsl(var(--muted))` (code block bg)
- `--color-accent-fg`       → `hsl(var(--primary))` (toolbar active state → amber)
- `--color-danger-fg`       → `hsl(var(--destructive))`

## Notes page: dock system removed
The custom dock/preview-panel system (hide/right/bottom/window dock buttons, `PanelGroup` splits, `openPreviewWindow`) was replaced by MDEditor's built-in Edit/Split/Preview toolbar buttons. In `notes.tsx`, the editor is rendered with `previewMode="live"` so users get the split view by default.

The `openPreviewWindow` utility was removed from `markdown-preview.tsx` entirely — no consumers remain.

## MarkdownEditor previewMode prop
`previewMode?: "edit" | "live" | "preview"` (default: `"edit"`)
- Modal usage: omit or pass `"edit"` (compact, no preview pane)
- Notes page: pass `"live"` (split editor + preview)
- Read-only: automatically set to `"preview"` regardless of prop
