/**
 * OrgGuard — suspension modal tests.
 *
 * Covers two scenarios:
 *  1. Login-time: org.isDisabled is true on the initial fetch → suspended
 *     modal shown, no children rendered.
 *  2. Mid-session: org loads OK, then a 403 org_suspended fires via
 *     onOrgSuspended → modal appears on top of children.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { OrgGuard } from "./org-guard";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

// onOrgSuspended listener captured so tests can trigger it.
let capturedSuspensionListener: (() => void) | null = null;

vi.mock("@workspace/api-client-react", () => ({
  useGetMyOrg: vi.fn(),
  onOrgSuspended: vi.fn((fn: () => void) => {
    capturedSuspensionListener = fn;
    return () => { capturedSuspensionListener = null; };
  }),
}));

vi.mock("@workspace/replit-auth-web", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("@/hooks/use-sse", () => ({
  useSseEvent: vi.fn(),
}));

vi.mock("@/components/ui/ownership-celebration", () => ({
  OwnershipCelebration: () => null,
}));

// OrgSuspendedModal: render a testable sentinel so we can assert open/closed.
vi.mock("@/components/ui/org-suspended-modal", () => ({
  OrgSuspendedModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="suspended-modal">suspended</div> : null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useGetMyOrg } from "@workspace/api-client-react";
const mockUseGetMyOrg = useGetMyOrg as ReturnType<typeof vi.fn>;

const ACTIVE_ORG = {
  org: { id: "org-1", name: "Test Org", isDisabled: false },
  roleName: "Member",
  roleId: "role-1",
  permissions: {},
  pendingInvitation: null,
  features: {},
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <OrgGuard
      onboarding={() => <div>onboarding</div>}
      invitation={() => <div>invitation</div>}
    >
      {children}
    </OrgGuard>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrgGuard suspension modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSuspensionListener = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the suspended modal and hides children when org.isDisabled is true at load", () => {
    mockUseGetMyOrg.mockReturnValue({
      data: { ...ACTIVE_ORG, org: { ...ACTIVE_ORG.org, isDisabled: true } },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<div data-testid="children">app content</div>, { wrapper });

    expect(screen.getByTestId("suspended-modal")).toBeInTheDocument();
    // Children must NOT be rendered when suspended at login time
    expect(screen.queryByTestId("children")).not.toBeInTheDocument();
  });

  it("shows the suspended modal over children when mid-session 403 org_suspended fires", async () => {
    mockUseGetMyOrg.mockReturnValue({
      data: ACTIVE_ORG,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<div data-testid="children">app content</div>, { wrapper });

    // Initially the app is running normally — no modal, children visible.
    expect(screen.queryByTestId("suspended-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();

    // Simulate a mid-session 403 org_suspended from any API call.
    await act(async () => {
      capturedSuspensionListener?.();
    });

    // Modal must appear, children still in DOM (modal overlays them).
    expect(screen.getByTestId("suspended-modal")).toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();
  });

  it("does not show the modal when org is active and no suspension signal fires", () => {
    mockUseGetMyOrg.mockReturnValue({
      data: ACTIVE_ORG,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<div data-testid="children">app content</div>, { wrapper });

    expect(screen.queryByTestId("suspended-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();
  });

  it("renders the loading spinner while org is fetching", () => {
    mockUseGetMyOrg.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });

    render(<div data-testid="children">app content</div>, { wrapper });

    // Neither modal nor children while loading
    expect(screen.queryByTestId("suspended-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("children")).not.toBeInTheDocument();
  });
});
