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
  const chipClass =
    "inline-flex items-center px-1 py-0.5 rounded bg-primary/15 text-primary text-sm font-medium";

  return text.replace(/@\[([^\]]+)\]/g, (_, inner: string) => {
    if (inner === "everyone") {
      return `<span class="${chipClass}">@everyone</span>`;
    }
    const colonIdx = inner.indexOf(":");
    if (colonIdx === -1) {
      // Unrecognised token — leave as-is so it is visible in the rendered output
      return `@[${inner}]`;
    }

    // Token format: "userId:DisplayName" (old) or "userId:DisplayName:email" (new).
    const rest = inner.slice(colonIdx + 1);
    const lastColon = rest.lastIndexOf(":");
    let displayName: string;
    let email: string | null = null;

    if (lastColon > 0) {
      const possibleEmail = rest.slice(lastColon + 1);
      if (possibleEmail.includes("@")) {
        displayName = rest.slice(0, lastColon);
        email = possibleEmail;
      } else {
        displayName = rest;
      }
    } else {
      displayName = rest;
    }

    // If the display name looks like an email (user has no real name set),
    // derive a friendlier label from the local-part (before "@") and use the
    // full address as the mailto target.
    // e.g. "testing@tortal.tech" → display "@testing", link "mailto:testing@tortal.tech"
    if (displayName.includes("@") && !displayName.includes(" ")) {
      if (!email) email = displayName;
      displayName = displayName.split("@")[0];
    }

    const safeDisplayName = escapeHtml(displayName);
    if (email) {
      const safeEmail = escapeHtml(email);
      return `<a href="mailto:${safeEmail}" class="${chipClass}">@${safeDisplayName}</a>`;
    }
    return `<span class="${chipClass}">@${safeDisplayName}</span>`;
  });
}

/**
 * Convert #[task:ID:Title] and #[project:ID:Name] reference tokens to inline
 * HTML anchor chips before the text is passed to ReactMarkdown.  rehype-raw
 * parses the raw HTML and rehype-sanitize allows <a> with data-ref-type /
 * data-ref-id (extended in sanitizeSchema), so the chips survive the full
 * remark→rehype→sanitize pass.
 *
 * Titles and names are HTML-escaped before interpolation to prevent XSS.
 *
 * Token formats:
 *   Task:    #[task:42:Fix login bug]
 *   Project: #[project:7:Mobile App]
 */
export function preprocessReferences(text: string): string {
  return text.replace(/#\[([^\]]+)\]/g, (match, inner: string) => {
    const firstColon = inner.indexOf(":");
    if (firstColon === -1) return match;

    const kind = inner.slice(0, firstColon);
    const rest = inner.slice(firstColon + 1);
    const secondColon = rest.indexOf(":");
    if (secondColon === -1) return match;

    const idStr = rest.slice(0, secondColon);
    const label = escapeHtml(rest.slice(secondColon + 1));
    const id = parseInt(idStr, 10);
    if (isNaN(id) || (kind !== "task" && kind !== "project")) return match;

    const href = kind === "task" ? `/tasks/${id}` : `/projects/${id}`;

    return `<a href="${href}" data-ref-type="${kind}" data-ref-id="${id}" class="inline-flex items-center px-1 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 text-sm font-medium no-underline hover:bg-blue-500/25">${label}</a>`;
  });
}

/**
 * Run all content pre-processors in sequence.
 * Apply to any markdown string before passing to ReactMarkdown so that both
 * @mention and #reference tokens are converted to styled chips.
 *
 * Code spans (` ... `) and fenced code blocks (``` ... ```) are shielded from
 * substitution so that a user who wraps a token in backticks sees the literal
 * token text, not the raw chip HTML.
 */
export function preprocessContent(text: string): string {
  // Temporarily replace code spans/blocks with null-byte-delimited placeholders
  // so the token regexes don't touch content inside them.
  const placeholders: string[] = [];
  // Order: longer fence first (``` before ``) so nested backticks parse correctly.
  const shielded = text.replace(
    /(```[\s\S]*?```|``[\s\S]*?``|`[^`\n]*`)/g,
    (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `\x00${idx}\x00`;
    },
  );

  const processed = preprocessReferences(preprocessMentions(shielded));

  // Restore code spans/blocks verbatim.
  return processed.replace(/\x00(\d+)\x00/g, (_, i) => placeholders[Number(i)]);
}
