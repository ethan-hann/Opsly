/**
 * Unit tests for preprocessMentions() and preprocessReferences() in comment-utils.ts.
 *
 * Both functions are pure string transforms — no DOM or React needed.
 */

import { describe, it, expect } from "vitest";
import { preprocessMentions, preprocessReferences, preprocessContent } from "./comment-utils";

// Helper: extract just the text content from chip spans and chip anchors.
function chipText(html: string): string[] {
  return [
    ...[...html.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]),
    ...[...html.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]),
  ];
}

// Helper: extract href attributes from anchor tags.
function chipHrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]+href="([^"]+)"/g)].map((m) => m[1]);
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

  // ── mailto link behavior ─────────────────────────────────────────────────────

  it("renders a mailto: link when the token has a third email field", () => {
    const result = preprocessMentions("@[u1:Alice Smith:alice@example.com]");
    expect(chipHrefs(result)).toContain("mailto:alice@example.com");
    expect(result).toContain("@Alice Smith");
    // Should be an <a> tag, not a bare <span>
    expect(result).toContain("<a ");
  });

  it("does not render a link for old-format tokens without an email field", () => {
    const result = preprocessMentions("@[u1:Alice Smith]");
    expect(result).not.toContain("<a ");
    expect(result).toContain("<span");
    expect(result).toContain("@Alice Smith");
  });

  it("uses the email-as-display-name as the mailto: address and derives label from local-part", () => {
    // Old tokens where the user had no real name — email was stored as display name.
    // The renderer now shows the local-part (before "@") as the label to keep it concise.
    const result = preprocessMentions("@[62395001:user@corp.example]");
    // mailto href should use the full email
    expect(chipHrefs(result)).toContain("mailto:user@corp.example");
    // label should be the local-part only, not the full email address
    expect(result).toContain(">@user<");
    expect(result).not.toContain("@user@corp.example");
  });

  it("does NOT render a link for @[everyone]", () => {
    const result = preprocessMentions("@[everyone]");
    expect(result).not.toContain("<a ");
    expect(result).toContain("<span");
  });

  it("escapes the email field in the mailto href to prevent XSS", () => {
    const result = preprocessMentions('@[u1:Alice:bad"@example.com]');
    expect(result).not.toContain('"@example.com"');
    expect(result).toContain("&quot;");
  });
});

// ── preprocessReferences ──────────────────────────────────────────────────────

describe("preprocessReferences", () => {
  // ── Task tokens ─────────────────────────────────────────────────────────────

  it("converts a task token to a link chip with /tasks/:id href", () => {
    const result = preprocessReferences("See #[task:42:Fix login bug]");
    expect(result).toContain('<a ');
    expect(result).toContain('href="/tasks/42"');
    expect(result).toContain('data-ref-type="task"');
    expect(result).toContain('data-ref-id="42"');
    expect(result).toContain("Fix login bug");
    expect(result).not.toContain("#[task:42:Fix login bug]");
  });

  it("renders the task title without a #T prefix", () => {
    const result = preprocessReferences("#[task:1:Deploy service]");
    expect(result).toContain("Deploy service");
    expect(result).not.toContain("#T");
  });

  // ── Project tokens ───────────────────────────────────────────────────────────

  it("converts a project token to a link chip with /projects/:id href", () => {
    const result = preprocessReferences("See #[project:7:Mobile App]");
    expect(result).toContain('href="/projects/7"');
    expect(result).toContain('data-ref-type="project"');
    expect(result).toContain('data-ref-id="7"');
    expect(result).toContain("Mobile App");
    expect(result).not.toContain("#[project:7:Mobile App]");
  });

  it("renders the project name without a #P prefix", () => {
    const result = preprocessReferences("#[project:5:Analytics Suite]");
    expect(result).toContain("Analytics Suite");
    expect(result).not.toContain("#P");
  });

  // ── Multiple tokens ──────────────────────────────────────────────────────────

  it("handles multiple reference tokens in one string", () => {
    const result = preprocessReferences(
      "Related: #[task:1:Task A] and #[project:2:Proj B]",
    );
    expect(result).toContain('href="/tasks/1"');
    expect(result).toContain('href="/projects/2"');
  });

  // ── Unknown / malformed tokens ───────────────────────────────────────────────

  it("leaves unknown token type as-is", () => {
    const result = preprocessReferences("#[note:5:Some note]");
    expect(result).toContain("#[note:5:Some note]");
    expect(result).not.toContain("<a ");
  });

  it("leaves token with no colon after kind as-is", () => {
    const result = preprocessReferences("#[task]");
    expect(result).toContain("#[task]");
  });

  it("leaves token with only one colon as-is", () => {
    const result = preprocessReferences("#[task:42]");
    expect(result).toContain("#[task:42]");
  });

  it("returns plain text unchanged when no reference tokens present", () => {
    const plain = "Just a comment with no references.";
    expect(preprocessReferences(plain)).toBe(plain);
  });

  it("returns empty string unchanged", () => {
    expect(preprocessReferences("")).toBe("");
  });

  // ── XSS prevention ──────────────────────────────────────────────────────────

  it("escapes < and > in a task title", () => {
    const result = preprocessReferences("#[task:1:<script>alert(1)</script>]");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes & in a project name", () => {
    const result = preprocessReferences("#[project:3:Alice & Bob]");
    expect(result).not.toContain(" & ");
    expect(result).toContain("Alice &amp; Bob");
  });

  it("escapes double-quotes in a task title", () => {
    const result = preprocessReferences('#[task:2:Say "hi"]');
    expect(result).not.toContain('"hi"');
    expect(result).toContain("&quot;hi&quot;");
  });
});

// ── preprocessContent (combined) ──────────────────────────────────────────────

describe("preprocessContent", () => {
  it("processes both mention and reference tokens in one pass", () => {
    const input = "cc @[u1:Alice] on #[task:5:Fix bug]";
    const result = preprocessContent(input);
    // Mention chip
    expect(result).toContain("@Alice");
    // Reference chip
    expect(result).toContain('href="/tasks/5"');
    expect(result).toContain("Fix bug");
  });

  it("passes through plain text unchanged", () => {
    const plain = "No tokens here.";
    expect(preprocessContent(plain)).toBe(plain);
  });

  it("handles only mention tokens", () => {
    const result = preprocessContent("@[everyone] look here");
    expect(result).toContain("@everyone");
  });

  it("handles only reference tokens", () => {
    const result = preprocessContent("#[project:2:Platform]");
    expect(result).toContain('href="/projects/2"');
  });
});
