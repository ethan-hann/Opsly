---
name: Mermaid securityLevel antiscript broken + render API changes in v11
description: mermaid 11 removed antiscript, changed the render API, and breaks when initialize() is called per-component
---

## Rules

1. Never use `securityLevel: "antiscript"` with mermaid 11+. Use `"loose"` instead.
2. Call `mermaid.initialize()` exactly once at module level (singleton), never inside a React component's useEffect.
3. Use `mermaid.run({ nodes: [el] })` instead of `mermaid.render(id, text)` — it's the officially recommended v10+ API.
4. The target `<div>` must always be mounted in the DOM when the useEffect fires; use CSS `hidden` to hide loading/error states rather than conditional rendering.

**Why (antiscript):** In mermaid 11, `antiscript` calls `DOMPurify.addHook()` which no longer exists as a standalone method, throwing `addHook is not a function` inside the render pipeline. The error lands in the component's catch block and silently shows "Invalid Mermaid syntax" for every diagram.

**Why (initialize once):** Calling `mermaid.initialize()` in every MermaidBlock instance (e.g. a note with two diagrams) resets mermaid's internal render queue between concurrent renders, causing all diagrams to fail. The singleton pattern ensures the queue is only set up once.

**Why (ref always mounted):** If the component conditionally renders `<div ref={elRef}>` only for the "done" state, `elRef.current` is null when the useEffect fires (during the "loading" state), so the effect exits immediately and the diagram never renders.

**How to apply:**
- `MermaidBlock` in `markdown-config.tsx` uses a module-level `getMermaid()` singleton.
- The target div is always rendered; loading/error overlays sit above it; the div is `hidden` until status is `"done"`.
- `mermaid.run({ nodes: [el], suppressErrors: false })` does the render after setting `el.textContent = code`.
