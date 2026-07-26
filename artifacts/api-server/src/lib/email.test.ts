/**
 * Unit tests for the HTML email builder functions in lib/email.ts.
 *
 * These functions are pure (no external dependencies), so no mocking is
 * required — the output is deterministic given the inputs.
 *
 * Covered:
 *  - buildInviteEmail: "Opsly" appears in both the header and the footer
 *  - buildInviteEmail: the org name, inviter name, and accept link are present
 */

import { vi, describe, it, expect } from "vitest";

// email.ts imports `db` from @workspace/db at module level (for the SMTP DB
// override feature).  Mock the package so the module can be imported without
// DATABASE_URL — the functions under test are pure HTML builders that never
// touch the database.
vi.mock("@workspace/db", () => ({
  db: {},
  instanceSmtpConfigTable: {},
}));

import { buildInviteEmail, buildSlaBreachEmail, buildDigestEmail, escapeHtml } from "./email.js";

describe("buildInviteEmail", () => {
  const BASE_OPTS = {
    orgName: "Acme Corp",
    inviterName: "Alice Smith",
    inviteLink: "https://app.example.com/invite/abc123",
    expiresAt: new Date("2030-12-31T00:00:00Z"),
  };

  it('includes "Opsly" in the header', () => {
    const html = buildInviteEmail(BASE_OPTS);
    // The header <div class="header"> must contain the brand name so the
    // recipient immediately knows who the email is from.
    const headerMatch = html.match(/<div class="header">[\s\S]*?<\/div>/);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch![0]).toContain("Opsly");
  });

  it('includes "Opsly" in the footer', () => {
    const html = buildInviteEmail(BASE_OPTS);
    // The footer <div class="footer"> must contain the brand name so the
    // email passes basic spam-filter sender-identity checks.
    const footerMatch = html.match(/<div class="footer">[\s\S]*?<\/div>/);
    expect(footerMatch).not.toBeNull();
    expect(footerMatch![0]).toContain("Opsly");
  });

  it("embeds the org name in the body", () => {
    const html = buildInviteEmail(BASE_OPTS);
    expect(html).toContain("Acme Corp");
  });

  it("embeds the inviter name in the body", () => {
    const html = buildInviteEmail(BASE_OPTS);
    expect(html).toContain("Alice Smith");
  });

  it("embeds the invite link as the CTA href", () => {
    const html = buildInviteEmail(BASE_OPTS);
    expect(html).toContain('href="https://app.example.com/invite/abc123"');
  });

  it("produces valid HTML with a DOCTYPE declaration", () => {
    const html = buildInviteEmail(BASE_OPTS);
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes < and >", () => {
    expect(escapeHtml("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("escapes &", () => {
    expect(escapeHtml("Alice & Bob")).toBe("Alice &amp; Bob");
  });

  it("escapes double-quotes", () => {
    expect(escapeHtml('Say "hi"')).toBe("Say &quot;hi&quot;");
  });

  it("escapes single-quotes", () => {
    expect(escapeHtml("O'Brien")).toBe("O&#39;Brien");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

// ─── XSS prevention in buildInviteEmail ──────────────────────────────────────

describe("buildInviteEmail — HTML injection prevention", () => {
  it("escapes < and > in inviterName so a display name cannot inject markup", () => {
    const html = buildInviteEmail({
      orgName: "Acme",
      inviterName: "<b>Hacker</b>",
      inviteLink: "https://example.com/invite/x",
      expiresAt: new Date("2030-01-01"),
    });
    expect(html).not.toContain("<b>Hacker</b>");
    expect(html).toContain("&lt;b&gt;Hacker&lt;/b&gt;");
  });

  it("escapes < and > in orgName", () => {
    const html = buildInviteEmail({
      orgName: "<script>alert(1)</script>",
      inviterName: "Alice",
      inviteLink: "https://example.com/invite/x",
      expiresAt: new Date("2030-01-01"),
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes & in inviterName", () => {
    const html = buildInviteEmail({
      orgName: "Acme",
      inviterName: "Alice & Bob",
      inviteLink: "https://example.com/invite/x",
      expiresAt: new Date("2030-01-01"),
    });
    expect(html).toContain("Alice &amp; Bob");
  });
});

// ─── XSS prevention in buildSlaBreachEmail ───────────────────────────────────

describe("buildSlaBreachEmail — HTML injection prevention", () => {
  const BASE = {
    orgName: "Acme Corp",
    taskUrl: "https://example.com/tasks/1",
    priority: "high",
    breachedAt: new Date("2030-06-01T12:00:00Z"),
  };

  it("escapes < and > in taskTitle so a task name cannot inject markup", () => {
    const html = buildSlaBreachEmail({ ...BASE, taskTitle: "<b>XSS</b>" });
    expect(html).not.toContain("<b>XSS</b>");
    expect(html).toContain("&lt;b&gt;XSS&lt;/b&gt;");
  });

  it("escapes < and > in orgName", () => {
    const html = buildSlaBreachEmail({ ...BASE, taskTitle: "Fix it", orgName: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes & in taskTitle", () => {
    const html = buildSlaBreachEmail({ ...BASE, taskTitle: "Server & DB down" });
    expect(html).toContain("Server &amp; DB down");
  });
});

// ─── XSS prevention in buildDigestEmail ──────────────────────────────────────

describe("buildDigestEmail — HTML injection prevention", () => {
  const BASE = {
    orgName: "Acme Corp",
    appUrl: "https://example.com",
    frequency: "daily" as const,
    unsubscribeUrl: "https://example.com/unsubscribe/token",
  };

  it("escapes < and > in userName so a display name cannot inject markup", () => {
    const html = buildDigestEmail({
      ...BASE,
      userName: "<b>Hacker</b>",
      notifications: [],
    });
    expect(html).not.toContain("<b>Hacker</b>");
    expect(html).toContain("&lt;b&gt;Hacker&lt;/b&gt;");
  });

  it("escapes < and > in notification message so task titles cannot inject markup", () => {
    const html = buildDigestEmail({
      ...BASE,
      userName: "Alice",
      notifications: [{
        message: 'Alice commented on "<script>alert(1)</script>"',
        createdAt: new Date("2030-06-01T10:00:00Z"),
        entityType: "task",
        entityId: 42,
      }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes & in orgName", () => {
    const html = buildDigestEmail({
      ...BASE,
      orgName: "R&D Team",
      userName: "Alice",
      notifications: [],
    });
    expect(html).toContain("R&amp;D Team");
  });

  it("escapes < in notification message containing a <b> tag", () => {
    const html = buildDigestEmail({
      ...BASE,
      userName: "Alice",
      notifications: [{
        message: "Assigned to task <b>Deploy prod</b>",
        createdAt: new Date("2030-06-01T10:00:00Z"),
        entityType: "task",
        entityId: 7,
      }],
    });
    expect(html).not.toMatch(/<b>Deploy/);
    expect(html).toContain("&lt;b&gt;Deploy prod&lt;/b&gt;");
  });
});
