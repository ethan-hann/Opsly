/**
 * Unit tests for picker-utils.ts
 *
 * Tests:
 *  - detectReferenceContext: / trigger boundary — URLs, paths, and mid-word
 *    slashes must NOT open the picker; start-of-line and post-whitespace / must.
 */

import { describe, it, expect } from "vitest";
import { detectReferenceContext } from "./picker-utils";

// ── Helper ────────────────────────────────────────────────────────────────────

function ctx(text: string, cursor?: number) {
  return detectReferenceContext(text, cursor ?? text.length);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("detectReferenceContext", () => {
  // ── Should activate ────────────────────────────────────────────────────────

  it("activates at start of text", () => {
    expect(ctx("/")).toMatchObject({ active: true, query: "", slashIdx: 0 });
  });

  it("activates when / follows a space", () => {
    expect(ctx("some text /")).toMatchObject({ active: true, query: "", slashIdx: 10 });
  });

  it("activates when / follows a newline", () => {
    expect(ctx("first line\n/")).toMatchObject({ active: true, query: "", slashIdx: 11 });
  });

  it("activates when / follows a tab", () => {
    expect(ctx("\t/")).toMatchObject({ active: true, query: "", slashIdx: 1 });
  });

  it("captures query text after /", () => {
    // Cursor at 14 = "Some text /fix" — right after "fix", before the space.
    expect(ctx("Some text /fix bug", 14)).toMatchObject({
      active: true,
      query: "fix",
      slashIdx: 10,
    });
  });

  it("captures empty query immediately after /", () => {
    expect(ctx("Note: /")).toMatchObject({ active: true, query: "", slashIdx: 6 });
  });

  // ── Should NOT activate ────────────────────────────────────────────────────

  it("does NOT activate inside a URL (https://)", () => {
    // Cursor is after "https://example" — the / is mid-word
    expect(ctx("See https://example.com", 20)).toMatchObject({ active: false });
  });

  it("does NOT activate for a second slash in a URL path", () => {
    expect(ctx("https://example.com/page")).toMatchObject({ active: false });
  });

  it("does NOT activate for a file path (/home/user)", () => {
    expect(ctx("Check /home/user/docs")).toMatchObject({ active: false });
  });

  it("does NOT activate when / is inside a word (e.g., n/a)", () => {
    expect(ctx("status: n/a")).toMatchObject({ active: false });
  });

  it("does NOT activate when / follows alphanumeric", () => {
    expect(ctx("v1/")).toMatchObject({ active: false });
  });

  it("does NOT activate when followed by a space (query contains space)", () => {
    expect(ctx("/ hello")).toMatchObject({ active: false });
  });

  it("does NOT activate when query contains a newline", () => {
    expect(ctx("/fix\n")).toMatchObject({ active: false });
  });

  it("does NOT activate when no / is present", () => {
    expect(ctx("plain text")).toMatchObject({ active: false });
  });

  it("closes picker when an already-inserted [ token follows /", () => {
    // If user typed /[task:1:Title] the picker should not reopen
    expect(ctx("/[task:1:Fix]")).toMatchObject({ active: false });
  });

  // ── Cursor in the middle of text ───────────────────────────────────────────

  it("uses only text before cursor for detection", () => {
    // Text is "/fix bug https://url.com" but cursor is at position 8 (after "/fix bug")
    // At that point the query contains a space so the picker should be closed.
    const text = "/fix bug https://url.com";
    expect(ctx(text, 8)).toMatchObject({ active: false });
  });

  it("is active when cursor is right after the trigger /", () => {
    const text = "See also / more text";
    // Cursor at position 10 — right after the space+slash
    expect(ctx(text, 10)).toMatchObject({ active: true, query: "", slashIdx: 9 });
  });
});
