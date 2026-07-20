/**
 * Server-side HTML sanitizer for rich-text description fields.
 *
 * Allows only the tags and attributes that TipTap's StarterKit produces so that
 * arbitrary HTML (e.g. <script>, event handlers, <iframe>) is stripped before
 * content is stored in the database.
 *
 * This is the trusted sanitization boundary.  Client-side DOMPurify is applied
 * as a defense-in-depth layer before rendering, but this server-side pass is the
 * authoritative gate.
 */

import sanitizeHtml from "sanitize-html";

/** Allowlist of tags produced by TipTap StarterKit */
const ALLOWED_TAGS: string[] = [
  // Block
  "p", "blockquote", "pre", "hr",
  // Headings
  "h1", "h2", "h3", "h4", "h5", "h6",
  // Lists
  "ul", "ol", "li",
  // Inline
  "strong", "em", "s", "code", "br",
];

/**
 * Sanitize a rich-text HTML string coming from the client.
 * Strips all disallowed tags and attributes; returns null if the input is null/undefined.
 */
export function sanitizeRichText(html: string | null | undefined): string | null {
  if (html == null) return null;

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},   // TipTap StarterKit produces no inline attributes we need
    allowedSchemes: [],       // no href / src in allowed tags so no URL schemes needed
    disallowedTagsMode: "discard",
  });

  // Treat a completely empty or whitespace-only result as null so callers can
  // distinguish "no description" from "empty description"
  const trimmed = clean.replace(/<p>\s*<\/p>/g, "").trim();
  return trimmed.length > 0 ? clean : null;
}
