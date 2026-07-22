/**
 * Shared utilities for the mention and reference picker popups.
 *
 * getCaretCoordinates — returns the viewport-relative pixel position of the
 * insertion caret inside a <textarea> using the mirror-div technique.
 *
 * computePickerRect — decides whether the popup should open below or above the
 * caret and returns a PickerRect that both picker components consume.
 */

export interface PickerRect {
  /** Viewport-relative Y anchor: bottom edge of the caret's line. */
  top: number;
  left: number;
  width: number;
  /** true  → render below the caret; false → render above (via CSS transform). */
  showBelow: boolean;
}

// Styles that affect text layout and must be mirrored to produce accurate
// character coordinates.
const MIRROR_PROPS = [
  "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch",
  "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "textDecoration",
  "letterSpacing", "wordSpacing", "tabSize",
] as const;

/**
 * Return the viewport-relative pixel position of the caret at `position`
 * inside `element`.  The returned `top` is the *bottom* of the caret line so
 * callers can open a popup directly below the active character.
 */
export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; lineHeight: number } {
  // Build a mirror div replicating the textarea's text layout.
  const div = document.createElement("div");
  const computed = window.getComputedStyle(element);
  for (const prop of MIRROR_PROPS) {
    (div.style as unknown as Record<string, string>)[prop] =
      computed.getPropertyValue(prop);
  }
  div.style.position = "absolute";
  div.style.top = "-9999px";
  div.style.left = "-9999px";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordBreak = "break-word";
  div.style.overflow = "hidden";

  // Text before the caret.
  div.appendChild(document.createTextNode(element.value.slice(0, position)));

  // Zero-width marker span at the caret position.
  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space
  div.appendChild(marker);

  document.body.appendChild(div);

  const taRect = element.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();

  // Position relative to the start of the div's content area.
  const relTop = markerRect.top - divRect.top;
  const relLeft = markerRect.left - divRect.left;

  // Map to viewport coordinates, accounting for the textarea's scroll offset.
  const top = taRect.top + relTop - element.scrollTop;
  const left = taRect.left + relLeft - element.scrollLeft;

  const lineHeight =
    parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4;

  document.body.removeChild(div);

  return { top, left, lineHeight };
}

/** Minimum vertical space (px) needed to comfortably show a picker below the caret. */
const PICKER_HEIGHT = 260;

/** Default maximum popup width. */
export const PICKER_MAX_WIDTH = 360;

// ── Reference trigger detection ───────────────────────────────────────────────

export type ReferenceContext =
  | { active: false }
  | { active: true; query: string; slashIdx: number };

/**
 * Determine whether a `/` reference picker should activate at `cursorPos`.
 *
 * A `/` is a command trigger only when it is at the very start of the text OR
 * immediately preceded by whitespace (space, tab, newline).  This prevents
 * activation inside URLs (`https://…`), file paths (`/home/…`), markdown
 * links, and any other word-internal slash.
 *
 * Returns `{ active: false }` whenever the picker should remain closed, or
 * `{ active: true, query, slashIdx }` when it should open / stay open.
 */
export function detectReferenceContext(
  text: string,
  cursorPos: number,
): ReferenceContext {
  const before = text.slice(0, cursorPos);
  const slashIdx = before.lastIndexOf("/");
  if (slashIdx === -1) return { active: false };

  // Reject if the character immediately before `/` is not whitespace.
  const charBefore = slashIdx > 0 ? before[slashIdx - 1] : null;
  if (charBefore !== null && !/[\s]/.test(charBefore)) return { active: false };

  const query = before.slice(slashIdx + 1);
  // Space, newline, or already-inserted `[` token closes the picker.
  if (query.includes(" ") || query.includes("\n") || query.includes("[")) {
    return { active: false };
  }

  return { active: true, query, slashIdx };
}

/**
 * Compute a PickerRect for positioning a picker popup next to the caret.
 * Opens below when there is enough space in the viewport; otherwise above.
 */
export function computePickerRect(
  element: HTMLTextAreaElement,
  cursorPos: number,
  maxWidth = PICKER_MAX_WIDTH,
): PickerRect {
  const { top: caretTop, left: caretLeft, lineHeight } =
    getCaretCoordinates(element, cursorPos);

  // Anchor = bottom edge of the caret line.
  const cursorBottom = caretTop + lineHeight;
  const spaceBelow = window.innerHeight - cursorBottom;
  const showBelow = spaceBelow >= PICKER_HEIGHT;

  // Clamp left so the popup stays within the viewport.
  const left = Math.max(4, Math.min(caretLeft, window.innerWidth - maxWidth - 8));

  return {
    top: cursorBottom,
    left,
    width: maxWidth,
    showBelow,
  };
}
