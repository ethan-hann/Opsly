/**
 * Server-side sanitizer for rich-text description fields.
 *
 * Content is now stored as Markdown (plain text with lightweight syntax).
 * react-markdown renders it safely by default — it does not execute raw HTML
 * unless the `rehype-raw` plugin is explicitly added (it is not).  No HTML
 * stripping library is needed; this function just normalises empty values to
 * null so callers can distinguish "no description" from an empty one.
 */

/**
 * Sanitise a Markdown string coming from the client.
 * Returns null when the input is null/undefined or whitespace-only.
 * Preserves the content as-is otherwise.
 */
export function sanitizeRichText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.trim().length > 0 ? text : null;
}
