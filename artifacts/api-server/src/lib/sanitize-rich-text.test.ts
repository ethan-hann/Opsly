import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "./sanitize-rich-text.js";

describe("sanitizeRichText", () => {
  it("returns null for null input", () => {
    expect(sanitizeRichText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(sanitizeRichText(undefined)).toBeNull();
  });

  it("returns null for an empty-paragraph TipTap document", () => {
    expect(sanitizeRichText("<p></p>")).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    expect(sanitizeRichText("<p>   </p>")).toBeNull();
  });

  it("preserves safe TipTap block tags", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    const result = sanitizeRichText(input);
    expect(result).toContain("<p>");
    expect(result).toContain("<strong>");
    expect(result).toContain("Hello");
  });

  it("preserves lists produced by TipTap", () => {
    const input = "<ul><li>Step one</li><li>Step two</li></ul>";
    const result = sanitizeRichText(input);
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>Step one</li>");
  });

  it("strips <script> tags and their content (stored XSS vector)", () => {
    const input = '<p>Hello</p><script>alert("xss")</script>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert(");
  });

  it("strips inline event handlers (onerror, onclick, etc.)", () => {
    const input = '<p onclick="alert(1)">Click me</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("alert(1)");
    // The safe text content is preserved
    expect(result).toContain("Click me");
  });

  it("strips <img> tags with javascript: src", () => {
    const input = '<img src="javascript:alert(1)" /><p>text</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("<img");
    expect(result).toContain("text");
  });

  it("strips <iframe> tags", () => {
    const input = '<iframe src="https://evil.com"></iframe><p>safe</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("<iframe");
    expect(result).toContain("safe");
  });

  it("strips <a href> links (not in TipTap StarterKit allowlist)", () => {
    const input = '<a href="javascript:alert(1)">click</a><p>text</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("<a");
    expect(result).toContain("text");
  });

  it("strips style attributes", () => {
    const input = '<p style="color:red;background:url(javascript:alert(1))">styled</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("style=");
    expect(result).toContain("styled");
  });

  it("strips SVG-based XSS payloads", () => {
    const input = '<svg onload="alert(1)"><p>text</p>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("onload");
    expect(result).toContain("text");
  });

  it("preserves em, code, and s inline tags", () => {
    const input = "<p><em>italic</em> and <code>code</code> and <s>strike</s></p>";
    const result = sanitizeRichText(input);
    expect(result).toContain("<em>italic</em>");
    expect(result).toContain("<code>code</code>");
    expect(result).toContain("<s>strike</s>");
  });

  it("preserves headings produced by TipTap", () => {
    const input = "<h2>Section title</h2><p>Body text</p>";
    const result = sanitizeRichText(input);
    expect(result).toContain("<h2>Section title</h2>");
    expect(result).toContain("<p>Body text</p>");
  });

  it("preserves pre and blockquote tags", () => {
    const input = "<blockquote><p>note</p></blockquote><pre><code>cmd</code></pre>";
    const result = sanitizeRichText(input);
    expect(result).toContain("<blockquote>");
    expect(result).toContain("<pre>");
  });
});
