/**
 * Dashboard — StatusBadge stage-color regression tests
 *
 * Confirms both the "SLA Breached" and "Attention Required" sections render
 * a colored stage-name badge (e.g. "In Progress") rather than the raw numeric
 * status value (e.g. "1") when the API supplies stageName + stageColor on
 * overdue task objects.
 */

import * as React from "react";
import { vi, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Task fixture — numeric stage-ID status, explicit stage name + color
// ---------------------------------------------------------------------------
const MOCK_TASK = {
  id: 1,
  orgId: "org-1",
  orgTaskNumber: 1,
  title: "Router is down",
  status: "1",               // numeric stage-ID — must NOT appear as badge text
  stageName: "In Progress",  // human-readable name the badge should show
  stageColor: "#f59e0b",
  stageArchived: false,
  stageType: "open",
  priority: "critical",
  projectId: null,
  projectName: "Network Ops",
  dueDate: null,
  slaBreachedAt: null,
  createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_SUMMARY = {
  activeProjects: 1,
  totalProjects: 1,
  tasksByStageType: { open: 1, closed: 0 },
  overdueCount: 1,
};

// ---------------------------------------------------------------------------
// Force getSlaStatus to report a resolution breach so the SLA Breached
// panel renders without needing a real DB or clock arithmetic.
// ---------------------------------------------------------------------------
vi.mock("@/lib/sla", () => ({
  getSlaStatus: () => ({
    isResolutionBreached: true,
    isResponseBreached: false,
    overallStatus: "breached" as const,
    resolutionStatus: "breached" as const,
    responseStatus: "none" as const,
  }),
  formatSlaMinutes: (m: number) => `${m}m`,
}));

// ---------------------------------------------------------------------------
// API hooks
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardSummary: () => ({ data: MOCK_SUMMARY, isLoading: false }),
  useGetRecentActivity: () => ({ data: [], isLoading: false }),
  useGetOverdueTasks: () => ({ data: [MOCK_TASK], isLoading: false }),
  useListProjects: () => ({ data: [], isLoading: false }),
  useGetSLAPolicies: () => ({
    data: [
      {
        id: 1,
        orgId: "org-1",
        projectId: null,
        priority: "critical",
        resolutionMinutes: 60,
        responseMinutes: null,
        warningThresholdPercent: 80,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  }),
  useGetDashboardSlaSummary: () => ({
    data: {
      complianceRate: 50,
      breachedCount: 1,
      withinSlaCount: 0,
      totalTracked: 1,
      avgBreachMinutes: 120,
      byPriority: [],
    },
    isLoading: false,
  }),
  getGetDashboardSummaryQueryKey: () => ["dashboardSummary"],
  getGetRecentActivityQueryKey: () => ["recentActivity"],
  getGetOverdueTasksQueryKey: () => ["overdueTasks"],
  getListProjectsQueryKey: () => ["projects"],
  getGetDashboardSlaSummaryQueryKey: () => ["dashboardSlaSummary"],
}));

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Leaf components with their own hook trees — stub to avoid mock cascade
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/sla-badge", () => ({
  SlaBadge: () => <span data-testid="sla-badge" />,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <button {...(props as object)}>{children}</button>
  ),
}));

vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  formatTimeAgo: () => "just now",
  cn: (...args: unknown[]) => (args.filter(Boolean) as string[]).join(" "),
}));

import Dashboard from "./dashboard.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Dashboard — StatusBadge renders stage names not raw status values", () => {
  it("renders the SLA Breached section when a task has a resolution breach", () => {
    renderDashboard();
    expect(screen.getByText("SLA Breached")).toBeInTheDocument();
  });

  it("renders the stage name in the SLA Breached section", () => {
    renderDashboard();
    // The task row inside "SLA Breached" must show the stage name, not a raw ID
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Attention Required section with the task present", () => {
    renderDashboard();
    expect(screen.getByText("Attention Required")).toBeInTheDocument();
    // The task title appears in both the SLA Breached and Attention Required panels
    expect(screen.getAllByText("Router is down").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the stage name badge in both SLA Breached and Attention Required sections", () => {
    renderDashboard();
    // The same task appears in both panels — "In Progress" must appear at
    // least twice (once per section).
    const badgeInstances = screen.getAllByText("In Progress");
    expect(badgeInstances.length).toBeGreaterThanOrEqual(2);
  });

  it("does not render the raw numeric status '1' inside a colored stage badge", () => {
    renderDashboard();
    // StatusBadge with stageName+stageColor renders the stage name; the raw
    // status ID "1" must never appear as badge text (inline color style present).
    const candidates = screen.queryAllByText("1");
    const coloredBadges = candidates.filter(
      (el) =>
        el.tagName === "SPAN" &&
        (el as HTMLElement).style.color !== "",
    );
    expect(coloredBadges).toHaveLength(0);
  });
});
