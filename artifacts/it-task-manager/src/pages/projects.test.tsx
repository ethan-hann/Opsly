/**
 * Permission-gate tests for the Projects list page.
 *
 * Asserts that the "New Project" button is present for users with
 * manage_projects and absent for users who lack it, without a live
 * API server or auth session.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mock state — readable by the vi.mock factories below
// ---------------------------------------------------------------------------
const mockHasPermission = vi.hoisted(() => vi.fn().mockReturnValue(true));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: mockHasPermission,
    isAdmin: false,
    isOwner: false,
    org: null,
    roleId: null,
    roleName: null,
    permissions: null,
    pendingInvitation: null,
    refetchOrg: vi.fn(),
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListProjects: () => ({ data: [], isLoading: false }),
}));

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/projects", vi.fn()],
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// Terminology — mock the context so no provider is needed in the tree
vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => key,
    ts: (key: string) => key,
    tSingular: (key: string) => key,
  }),
  TerminologyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Modal is irrelevant to permission gating — render as null
vi.mock("@/components/ui/new-project-modal", () => ({
  NewProjectModal: () => null,
}));

// UI primitives used for loading state
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => null,
  PriorityBadge: () => null,
}));

vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

// React must be in scope for JSX in the factory functions above
import React from "react";
import ProjectsList from "./projects.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Projects page — manage_projects permission gate", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
  });

  it("shows the New Project button when the user has manage_projects", () => {
    mockHasPermission.mockReturnValue(true);

    render(<ProjectsList />);

    expect(
      screen.getByTestId("button-create-project"),
    ).toBeInTheDocument();
  });

  it("hides the New Project button when the user lacks manage_projects", () => {
    mockHasPermission.mockReturnValue(false);

    render(<ProjectsList />);

    expect(
      screen.queryByTestId("button-create-project"),
    ).not.toBeInTheDocument();
  });
});
