/**
 * Tests for BrandingProvider (branding-context.tsx)
 *
 * Confirms that:
 *  - A custom primaryColor injects a <style> tag with CSS variable overrides
 *  - When primaryColor becomes null the style tag is removed (no bleed to
 *    another org's session on switch or logout)
 *  - When the branding feature is disabled the style tag is never injected even
 *    if primaryColor is set (no cross-org CSS leakage through feature toggles)
 *  - The style tag is removed on provider unmount (logout / org switch path)
 *  - Two successive org sessions cannot bleed color from the first into the second
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock dependencies ────────────────────────────────────────────────────────

interface MockOrgResponse {
  org: { primaryColor: string | null; logoUrl: string | null } | null;
}

let _mockOrgData: MockOrgResponse = { org: null };
let _brandingEnabled = true;

vi.mock("@workspace/api-client-react", () => ({
  useGetMyOrg: () => ({ data: _mockOrgData }),
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({ isFeatureEnabled: (_feat: string) => _brandingEnabled }),
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { BrandingProvider, useBranding } from "./branding-context.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STYLE_TAG_ID = "opsly-branding-overrides";

function getStyleTag(): HTMLStyleElement | null {
  return document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
}

/** Consumer that exposes context values for assertions. */
function BrandingConsumer() {
  const { primaryColor, logoUrl } = useBranding();
  return (
    <div>
      <span data-testid="primary-color">{primaryColor ?? "null"}</span>
      <span data-testid="logo-url">{logoUrl ?? "null"}</span>
    </div>
  );
}

function Wrapper() {
  return (
    <BrandingProvider>
      <BrandingConsumer />
    </BrandingProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BrandingProvider — CSS variable injection", () => {
  beforeEach(() => {
    // Reset DOM and mock state before each test
    _mockOrgData = { org: null };
    _brandingEnabled = true;
    getStyleTag()?.remove();
  });

  it("injects a <style> tag when primaryColor is a valid hex string", () => {
    _mockOrgData = { org: { primaryColor: "#2563eb", logoUrl: null } };
    render(<Wrapper />);

    const tag = getStyleTag();
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toContain("--primary");
  });

  it("style tag content contains both :root and .dark overrides", () => {
    _mockOrgData = { org: { primaryColor: "#f59e0b", logoUrl: null } };
    render(<Wrapper />);

    const css = getStyleTag()?.textContent ?? "";
    expect(css).toContain(":root");
    expect(css).toContain(".dark");
    expect(css).toContain("--primary:");
    expect(css).toContain("--sidebar-primary:");
  });

  it("does NOT inject a style tag when primaryColor is null", () => {
    _mockOrgData = { org: { primaryColor: null, logoUrl: null } };
    render(<Wrapper />);

    expect(getStyleTag()).toBeNull();
  });

  it("does NOT inject a style tag when org data is absent (loading)", () => {
    _mockOrgData = { org: null };
    render(<Wrapper />);

    expect(getStyleTag()).toBeNull();
  });
});

describe("BrandingProvider — style tag cleared when color is removed (org isolation)", () => {
  beforeEach(() => {
    _mockOrgData = { org: null };
    _brandingEnabled = true;
    getStyleTag()?.remove();
  });

  it("removes the style tag when primaryColor transitions from a hex to null", () => {
    _mockOrgData = { org: { primaryColor: "#cc0000", logoUrl: null } };
    const { rerender } = render(<Wrapper />);
    expect(getStyleTag()).not.toBeNull();

    // Simulate the user's org clearing its brand color — or the user switching
    // to an org with no primaryColor set
    _mockOrgData = { org: { primaryColor: null, logoUrl: null } };
    rerender(<Wrapper />);

    expect(getStyleTag()).toBeNull();
  });

  it("replaces the style tag content when primaryColor changes between two colors", () => {
    _mockOrgData = { org: { primaryColor: "#ff0000", logoUrl: null } };
    const { rerender } = render(<Wrapper />);
    const firstCss = getStyleTag()?.textContent;
    expect(firstCss).toBeDefined();

    _mockOrgData = { org: { primaryColor: "#0000ff", logoUrl: null } };
    rerender(<Wrapper />);

    const updatedCss = getStyleTag()?.textContent;
    // Tag still present but content changed — no ghost styles from org A
    expect(getStyleTag()).not.toBeNull();
    expect(updatedCss).not.toBe(firstCss);
  });

  it("org A color does not persist into org B session (two successive mounts)", () => {
    // Org A session
    _mockOrgData = { org: { primaryColor: "#ff0000", logoUrl: null } };
    const { unmount } = render(<Wrapper />);
    expect(getStyleTag()).not.toBeNull();

    // Unmount simulates logout / org switch unmounting the provider
    unmount();
    expect(getStyleTag()).toBeNull();

    // Org B session — no primaryColor
    _mockOrgData = { org: { primaryColor: null, logoUrl: "https://b.example.com/logo.png" } };
    render(<Wrapper />);

    // Org A's style tag must not have survived into org B's session
    expect(getStyleTag()).toBeNull();
    expect(screen.getByTestId("primary-color").textContent).toBe("null");
  });
});

describe("BrandingProvider — feature-flag gate prevents injection", () => {
  beforeEach(() => {
    _mockOrgData = { org: null };
    _brandingEnabled = true;
    getStyleTag()?.remove();
  });

  it("does NOT inject a style tag when branding feature is disabled, even if primaryColor is set", () => {
    _brandingEnabled = false;
    _mockOrgData = { org: { primaryColor: "#f59e0b", logoUrl: null } };
    render(<Wrapper />);

    expect(getStyleTag()).toBeNull();
  });

  it("exposes null primaryColor through context when branding feature is disabled", () => {
    _brandingEnabled = false;
    _mockOrgData = { org: { primaryColor: "#f59e0b", logoUrl: "https://example.com/logo.png" } };
    render(<Wrapper />);

    expect(screen.getByTestId("primary-color").textContent).toBe("null");
    expect(screen.getByTestId("logo-url").textContent).toBe("null");
  });

  it("removes the style tag when the branding feature is toggled off mid-session", () => {
    _brandingEnabled = true;
    _mockOrgData = { org: { primaryColor: "#2563eb", logoUrl: null } };
    const { rerender } = render(<Wrapper />);
    expect(getStyleTag()).not.toBeNull();

    // Admin disables the branding feature for this org
    _brandingEnabled = false;
    rerender(<Wrapper />);

    expect(getStyleTag()).toBeNull();
  });
});

describe("BrandingProvider — context values", () => {
  beforeEach(() => {
    _mockOrgData = { org: null };
    _brandingEnabled = true;
    getStyleTag()?.remove();
  });

  it("exposes primaryColor through context when branding is enabled and color is set", () => {
    _brandingEnabled = true;
    _mockOrgData = { org: { primaryColor: "#f59e0b", logoUrl: null } };
    render(<Wrapper />);

    expect(screen.getByTestId("primary-color").textContent).toBe("#f59e0b");
  });

  it("exposes logoUrl through context when branding is enabled", () => {
    _brandingEnabled = true;
    _mockOrgData = { org: { primaryColor: null, logoUrl: "https://cdn.example.com/logo.png" } };
    render(<Wrapper />);

    expect(screen.getByTestId("logo-url").textContent).toBe("https://cdn.example.com/logo.png");
  });
});
