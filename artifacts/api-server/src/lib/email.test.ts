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

import { describe, it, expect } from "vitest";
import { buildInviteEmail } from "./email.js";

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
