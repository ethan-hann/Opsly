---
name: MDEditor token rendering
description: How @mention and #reference tokens render as chips in MarkdownEditor's live preview and other surfaces
---

# MDEditor token rendering — mention/reference chips

## The rule
Token preprocessing uses TWO mechanisms that must coexist:

1. **`remarkPreprocessTokens` plugin** (in `markdown-config.tsx` `remarkPlugins`) — wraps `this.Parser` during unified's `freeze()` phase. Required for MDEditor's internal live-preview pane, which always supplies raw markdown source and ignores any `source` in `previewOptions`.

2. **Explicit `preprocessContent()`** calls before `ReactMarkdown` in `MarkdownPreview.tsx` and `task-detail.tsx` — required for those surfaces; safe to have alongside the plugin because `preprocessContent` is idempotent (calling it on already-processed HTML is a no-op).

**Why:** MDEditor's factory code spreads `previewOptions` then **overrides** `source` with its own `state.markdown`:
```js
_jsx(PreviewComponent, _extends({}, previewOptions, { source: state.markdown || '' }))
```
So `previewOptions.source = preprocessContent(value)` is silently ignored. The plugin is the only hook that intercepts before the micromark lexer.

## How to apply
- Any new markdown render surface that controls its own source string: call `preprocessContent(content)` before passing to `ReactMarkdown`.
- Any surface that goes through `remarkPlugins` (all of them do): the plugin handles it automatically as a safety net.
- **Do not** put `source` in `previewOptions` — it is always overridden.

## Why the plugin + explicit calls coexist safely
`preprocessContent` converts `@[...]` / `#[...]` tokens to HTML chip strings. On already-converted HTML, none of those patterns match, so a second call is a no-op. No double-processing side effects.

## Token format for mentions
- Named user: `@[userId:First Last:email@domain.com]` (3 parts)
- Email-only user: `@[userId:email@domain.com]` (2 parts; renderer derives label from local-part, e.g. `@testing`)
- `buildMemberToken()` in `markdown-editor.tsx` produces the correct format.

## `remarkPreprocessTokens` and tests
The plugin works in production (browser). In vitest/JSDOM tests, `this.Parser` wrapping appears unreliable, so test files that test chip rendering should rely on the explicit `preprocessContent()` call path rather than the plugin. Tests pass because explicit preprocessing handles those surfaces.
