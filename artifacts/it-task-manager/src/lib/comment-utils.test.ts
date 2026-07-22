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
});
