# #378 — Confirm the preview stays readable when an extreme hue or very dark/light color is chosen

**State:** PROPOSED
**Depends on:** #319

---

# Confirm the preview stays readable when an extreme hue or very dark/light color is chosen

## What & Why
The `derivePalette` function clamps saturation and lightness to keep colors readable, but edge cases (near-black, near-white, hyper-saturated neons) may still produce low-contrast combinations in the live preview panel — making text invisible or badges unreadable before saving.

## Done looks like
- Unit tests for `derivePalette` in `branding-context.tsx` covering black (#000000), white (#ffffff), and saturated neons (#ff0000, #00ff00, #0000ff)
- Each test asserts the WCAG contrast ratio between primary/primaryForeground and accent/accentForeground is ≥ 4.5 for light mode and ≥ 3.0 for dark mode
- All edge cases pass without manually adjusting the palette logic

## Relevant files
- `artifacts/it-task-manager/src/context/branding-context.tsx` (derivePalette, hexToHsl)
- `artifacts/it-task-manager/src/__tests__/` (or wherever FE tests live)
