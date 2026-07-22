/**
 * Utilities for comment content processing.
 */

/**
 * Escape characters that are special in HTML attribute values and text content.
 * Applied to user-supplied display names before they are interpolated into the
 * raw HTML span string that preprocessMentions() produces.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert @[userId:Display Name] and @[everyone] mention tokens to inline HTML
 * spans before the text is passed to ReactMarkdown.  rehype-raw in the shared
 * plugin pipeline will parse the raw HTML, and rehype-sanitize allows <span>
 * with className, so the chips survive the full remark→rehype→sanitize pass.
 *
 * Display names are HTML-escaped before interpolation so that a name containing
 * `<`, `>`, `&`, or `"` cannot inject markup into the span.
 */
export function preprocessMentions(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, (_, inner: string) => {
    if (inner === "everyone") {
      return `<span class="inline-flex items-center px-1 py-0.5 rounded bg-primary/15 text-primary text-sm font-medium">@everyone</span>`;
    }
    const colonIdx = inner.indexOf(":");
    if (colonIdx !== -1) {
      const displayName = escapeHtml(inner.slice(colonIdx + 1));
      return `<span class="inline-flex items-center px-1 py-0.5 rounded bg-primary/15 text-primary text-sm font-medium">@${displayName}</span>`;
    }
    // Unrecognised token — leave as-is so it is visible in the rendered output
    return `@[${inner}]`;
  });
}
