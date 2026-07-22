---
name: Mermaid securityLevel antiscript broken
description: mermaid 11 removed the antiscript securityLevel; using it crashes DOMPurify and makes every diagram fail silently
---

## Rule
Never use `securityLevel: "antiscript"` with mermaid 11+. Use `"loose"` instead.

**Why:** In mermaid 11, `antiscript` calls `DOMPurify.addHook()` which no longer exists as a standalone method, throwing `addHook is not a function` inside the mermaid render pipeline. The error is caught by the `try/catch` in `MermaidBlock` and silently shows "Invalid Mermaid syntax" for every diagram regardless of content.

**How to apply:** The `MermaidBlock` component in `markdown-config.tsx` initializes mermaid with `securityLevel: "loose"`. SVG output is still sanitized by `sanitizeSvg()` before DOM insertion, so there is no security regression.
