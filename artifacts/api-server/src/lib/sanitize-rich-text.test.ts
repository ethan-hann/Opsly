import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "./sanitize-rich-text.js";

describe("sanitizeRichText (markdown mode)", () => {
  it("returns null for null input", () => {
    expect(sanitizeRichText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(sanitizeRichText(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(sanitizeRichText("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(sanitizeRichText("   \n\t  ")).toBeNull();
  });

  it("preserves regular markdown content as-is", () => {
    const md = "## Steps\n\n- Check logs\n- **Restart** the service";
    expect(sanitizeRichText(md)).toBe(md);
  });

  it("preserves GFM task list syntax", () => {
    const md = "- [ ] Open ticket\n- [x] Notify on-call";
    expect(sanitizeRichText(md)).toBe(md);
  });

  it("preserves inline code and code blocks", () => {
    const md = "Run `kubectl get pods` then:\n\n```bash\nkubectl logs <pod>\n```";
    expect(sanitizeRichText(md)).toBe(md);
  });

  it("does not strip angle-bracket content (markdown raw HTML is safe via react-markdown defaults)", () => {
    // react-markdown does NOT execute raw HTML without rehype-raw, so content is
    // rendered as escaped text — no sanitization needed at the storage layer.
    const md = "See <https://example.com> for details";
    expect(sanitizeRichText(md)).toBe(md);
  });

  it("returns non-null for single-character content", () => {
    expect(sanitizeRichText("x")).toBe("x");
  });
});
