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

**Root cause (final, confirmed)**:
Two separate bugs, both in `rehypeSanitize`:

1. **Missing tagNames**: `remark-github-blockquote-alert` transforms `[!NOTE]` into `<div class="markdown-alert markdown-alert-note">` with an SVG icon. `div`/`svg`/`path` are not in `defaultSchema.tagNames`, so they were stripped → bare unstyled `<p>` tags.

2. **Missing `className` in allowlist**: `hast-util-sanitize`'s `defaultSchema.attributes["*"]` uses HAST property names. `className` (the HAST name for HTML `class`) is **not** in that list. This means `rehypeSanitize` stripped `className` from every element in every pipeline — so both the `div.markdown-alert-*` class check (MDEditor path) and the `callout callout-*` class check (standalone path) always returned null, causing everything to fall through to the plain-blockquote fallback.

**Fix** (in `markdown-config.tsx` `sanitizeSchema`):
1. Add `"div"`, `"svg"`, `"path"` to `tagNames`.
2. Add `"className"` to `attributes["*"]` (restores class on all elements).
3. Use HAST property names throughout: `div: ["className","dir"]`, `svg: ["className","viewBox","width","height","ariaHidden"]`, `path: ["d"]`.
4. Add `"data*"` wildcard to `blockquote` attributes (covers `data-callout` regardless of camelCase conversion).

**Two-pipeline awareness** (still applies):
- MDEditor path: `remark-github-blockquote-alert` (prepended by library) → `div.markdown-alert-*` → `div` component renderer intercepts, renders callout card.
- Standalone path: `remarkCallouts` (our plugin) → `blockquote[data-callout=TYPE]` with `className="callout callout-TYPE"` → `blockquote` component renderer intercepts, renders callout card.

**Why `className` fallback in `blockquote` component is still needed**: the standalone MarkdownPreview path uses react-markdown without `remarkAlert`; `remarkCallouts` stamps the class there and the blockquote component reads it.

## Notes page: dock system removed
The custom dock/preview-panel system (hide/right/bottom/window dock buttons, `PanelGroup` splits, `openPreviewWindow`) was replaced by MDEditor's built-in Edit/Split/Preview toolbar buttons. In `notes.tsx`, the editor is rendered with `previewMode="live"` so users get the split view by default.

The `openPreviewWindow` utility was removed from `markdown-preview.tsx` entirely — no consumers remain.

## MarkdownEditor previewMode prop
`previewMode?: "edit" | "live" | "preview"` (default: `"edit"`)
- Modal usage: omit or pass `"edit"` (compact, no preview pane)
- Notes page: pass `"live"` (split editor + preview)
- Read-only: automatically set to `"preview"` regardless of prop
