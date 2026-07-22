/**
 * Unit tests for preprocessMentions() in comment-utils.ts.
 *
 * preprocessMentions() is a pure string transform — no DOM or React needed.
 */

import { describe, it, expect } from "vitest";
import { preprocessMentions } from "./comment-utils";

// Helper: extract just the text content from a chip span, ignoring class noise.
function chipText(html: string): string[] {
  return [...html.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
}

describe("preprocessMentions", () => {
  // ── Named user mentions ─────────────────────────────────────────────────────

  it("converts a user mention token to a chip span", () => {
    const result = preprocessMentions("Hello @[u123:Alice]!");
    expect(result).toContain("<span");
    expect(chipText(result)).toEqual(["@Alice"]);
    // Raw token must not appear in the output
    expect(result).not.toContain("@[u123:Alice]");
  });

  it("uses only the display name, not the user-id prefix", () => {
    const result = preprocessMentions("@[abc-999:Bob Smith]");
    expect(chipText(result)).toEqual(["@Bob Smith"]);
  });

  it("handles multiple user mention tokens in one string", () => {
    const result = preprocessMentions("@[u1:Alice] and @[u2:Bob] reviewed this.");
    const chips = chipText(result);
    expect(chips).toEqual(["@Alice", "@Bob"]);
  });

  // ── @everyone ───────────────────────────────────────────────────────────────

  it("converts @[everyone] to an @everyone chip span", () => {
    const result = preprocessMentions("@[everyone] please note.");
    expect(result).toContain("<span");
    expect(chipText(result)).toEqual(["@everyone"]);
    expect(result).not.toContain("@[everyone]");
  });

  it("handles @[everyone] alongside a named mention", () => {
    const result = preprocessMentions("@[everyone] cc @[u1:Alice]");
    const chips = chipText(result);
    expect(chips).toContain("@everyone");
    expect(chips).toContain("@Alice");
  });

  // ── Unrecognised tokens ──────────────────────────────────────────────────────

  it("leaves unrecognised tokens as-is (no colon, not 'everyone')", () => {
    const result = preprocessMentions("Hello @[mystery]");
    // Should be passed through verbatim so it is visible in rendered output
    expect(result).toContain("@[mystery]");
    expect(result).not.toContain("<span");
  });

  // ── Mixed markdown + mention ─────────────────────────────────────────────────

  it("does not alter markdown syntax surrounding a mention", () => {
    const input = "**Bold** @[u1:Alice] _italic_ `code`";
    const result = preprocessMentions(input);
    // Markdown tokens must survive untouched
    expect(result).toContain("**Bold**");
    expect(result).toContain("_italic_");
    expect(result).toContain("`code`");
    // Mention is replaced
    expect(chipText(result)).toEqual(["@Alice"]);
    expect(result).not.toContain("@[u1:Alice]");
  });

  it("works when a mention appears inside a markdown list item", () => {
    const input = "- Item one\n- cc @[u2:Bob]\n- Item three";
    const result = preprocessMentions(input);
    expect(chipText(result)).toEqual(["@Bob"]);
    expect(result).toContain("- Item one");
    expect(result).toContain("- Item three");
  });

  it("handles a mention immediately adjacent to punctuation", () => {
    const result = preprocessMentions("Thanks, @[u1:Alice]!");
    expect(chipText(result)).toEqual(["@Alice"]);
  });

  // ── Plain text passthrough ───────────────────────────────────────────────────

  it("returns plain text unchanged when no mention tokens are present", () => {
    const plain = "Just a regular comment with no mentions.";
    expect(preprocessMentions(plain)).toBe(plain);
  });

  it("returns an empty string unchanged", () => {
    expect(preprocessMentions("")).toBe("");
  });

  // ── XSS / HTML injection prevention ─────────────────────────────────────────
  // Display names come from user-supplied data.  They must be HTML-escaped
  // before interpolation so they cannot inject markup into the span string.

  it("escapes < and > in a display name containing a <script> tag", () => {
    const result = preprocessMentions("@[u1:<script>alert(1)</script>]");
    // Must not contain a literal opening tag
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
    // The escaped form must be present so the text is still visible
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes < and > in a display name containing a <b> tag", () => {
    const result = preprocessMentions("@[u2:<b>Bold</b>]");
    expect(result).not.toMatch(/<b>/);
    expect(result).toContain("&lt;b&gt;");
    // Text content still visible
    expect(result).toContain("Bold");
  });

  it("escapes & in a display name", () => {
    const result = preprocessMentions("@[u3:Alice & Bob]");
    expect(result).not.toContain(" & ");
    expect(result).toContain("Alice &amp; Bob");
  });

  it("escapes double-quotes in a display name", () => {
    const result = preprocessMentions('@[u4:Say "hi"]');
    expect(result).not.toContain('"hi"');
    expect(result).toContain("&quot;hi&quot;");
  });

  it("escapes single-quotes in a display name", () => {
    const result = preprocessMentions("@[u5:O'Brien]");
    expect(result).not.toContain("O'Brien");
    expect(result).toContain("O&#39;Brien");
  });

  it("does not escape @[everyone] — it is a fixed literal, not user-supplied", () => {
    const result = preprocessMentions("@[everyone]");
    // @everyone chip should render cleanly without any entity encoding
    expect(result).toContain("@everyone");
    expect(result).not.toContain("&");
  });

  it("escapes a display name that is entirely angle brackets", () => {
    const result = preprocessMentions("@[u6:<><>]");
    expect(result).not.toMatch(/<>/);
    expect(result).toContain("&lt;&gt;");
  });
});
