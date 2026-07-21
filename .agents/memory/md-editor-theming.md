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

## Callout rendering — two separate pipelines

**Standalone `MarkdownPreview`** uses `react-markdown` directly. `remarkCallouts` runs, stamps `data-callout` + `className="callout callout-note"` on the blockquote, and the custom `blockquote` component in `previewComponents` renders the styled box.

**MDEditor built-in preview** uses `@uiw/react-markdown-preview`, which hard-codes `remarkAlert` from `remark-github-blockquote-alert` *before* any plugins we supply (see `preview.js` line 55: `[remarkAlert, ...our plugins, gfm]`). `remarkAlert` transforms the blockquote into `<div class="markdown-alert markdown-alert-note">` with a `<p class="markdown-alert-title">` child — **the `blockquote` component is never called**. Our `remarkCallouts` plugin runs after but finds no `[!NOTE]` text (already consumed) and does nothing.

**Root cause**: `remark-github-blockquote-alert` uses `hName: "div"` to transform the blockquote into a `<div class="markdown-alert markdown-alert-note">`. But `div` is **not** in `hast-util-sanitize`'s `defaultSchema.tagNames`, so our `rehypeSanitize` pass strips the wrapper div and leaves bare `<p>` tags — completely unstyled.

**Fix**:
1. Add `"div"`, `"svg"`, `"path"` to `sanitizeSchema.tagNames` in `markdown-config.tsx` (so the alert wrapper and GitHub octicon icons survive sanitization).
2. Add allowed attributes: `div: ["class","dir"]`, `svg: ["class","viewBox","width","height","ariaHidden"]`, `path: ["d"]`, `p: [..., "dir"]`.
3. Pure CSS in `index.css` overrides `.wmde-markdown .markdown-alert*` with our design-system colours. No React component customisation needed for the editor preview path.

**Why `className` fallback in `blockquote` component is still needed**: the standalone MarkdownPreview path uses react-markdown without `remarkAlert`; `remarkCallouts` stamps the class there and the blockquote component reads it.

## Notes page: dock system removed
The custom dock/preview-panel system (hide/right/bottom/window dock buttons, `PanelGroup` splits, `openPreviewWindow`) was replaced by MDEditor's built-in Edit/Split/Preview toolbar buttons. In `notes.tsx`, the editor is rendered with `previewMode="live"` so users get the split view by default.

The `openPreviewWindow` utility was removed from `markdown-preview.tsx` entirely — no consumers remain.

## MarkdownEditor previewMode prop
`previewMode?: "edit" | "live" | "preview"` (default: `"edit"`)
- Modal usage: omit or pass `"edit"` (compact, no preview pane)
- Notes page: pass `"live"` (split editor + preview)
- Read-only: automatically set to `"preview"` regardless of prop
