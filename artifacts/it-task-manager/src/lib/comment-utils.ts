/**
 * Utilities for comment content processing.
 */

/**
 * Convert @[userId:Display Name] and @[everyone] mention tokens to inline HTML
 * spans before the text is passed to ReactMarkdown.  rehype-raw in the shared
 * plugin pipeline will parse the raw HTML, and rehype-sanitize allows <span>
 * with className, so the chips survive the full remark→rehype→sanitize pass.
 */
export function preprocessMentions(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, (_, inner: string) => {
    if (inner === "everyone") {
      return `<span class="inline-flex items-center px-1 py-0.5 rounded bg-primary/15 text-primary text-sm font-medium">@everyone</span>`;
    }
    const colonIdx = inner.indexOf(":");
    if (colonIdx !== -1) {
      const displayName = inner.slice(colonIdx + 1);
      return `<span class="inline-flex items-center px-1 py-0.5 rounded bg-primary/15 text-primary text-sm font-medium">@${displayName}</span>`;
    }
    // Unrecognised token — leave as-is so it is visible in the rendered output
    return `@[${inner}]`;
  });
}
