/**
 * Terminology invalidation chain tests
 *
 * Verifies that after saving custom terminology via PATCH /api/orgs/terminology,
 * invalidating the `getGetMyOrgQueryKey()` cache causes TerminologyProvider to
 * re-read the updated data, so nav labels (Projects, Tasks, etc.) update on the
 * next render without a full page reload.
 *
 * The chain under test:
 *   usePatchOrgTerminology onSuccess
 *     → queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() })
 *       → useGetMyOrg() refetches
 *         → TerminologyProvider re-derives t() / ts()
 *           → AppLayout nav items re-render with new labels
 *
 * Strategy: we mock useGetMyOrg to return a mutable module-level value.
 * Updating that value then re-rendering (mirroring what React Query does when
 * the cache updates) proves TerminologyProvider correctly propagates new data
 * to its consumers without a page reload.
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgTerminology {
  projects?: string | null;
  tasks?: string | null;
  members?: string | null;
  workflows?: string | null;
  stages?: string | null;
  projectsSingular?: string | null;
  tasksSingular?: string | null;
  membersSingular?: string | null;
  workflowsSingular?: string | null;
  stagesSingular?: string | null;
}

interface OrgData {
  id: string;
  name: string;
  terminology: OrgTerminology;
}

// ── Mutable mock state ─────────────────────────────────────────────────────────
//
// The mock closure captures this variable. Updating it before a re-render
// is equivalent to React Query delivering fresh data from the server —
// the exact effect of queryClient.invalidateQueries() resolving.

let _mockOrgData: OrgData | null = null;

vi.mock("@workspace/api-client-react", () => ({
  useGetMyOrg: () => ({ data: _mockOrgData, isLoading: _mockOrgData === null }),
  getGetMyOrgQueryKey: () => ["getMyOrg"],
}));

// ── Module under test ─────────────────────────────────────────────────────────

import {
  TerminologyProvider,
  useTerminology,
  TERM_DEFAULTS,
  singularize,
} from "./terminology-context.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildOrg(terminology: OrgTerminology = {}): OrgData {
  return { id: "org-1", name: "Acme", terminology };
}

/** Consumer that surfaces every label we want to assert on. */
function NavLabels() {
  const { t, ts } = useTerminology();
  return (
    <nav>
      <span data-testid="projects-label">{t("projects")}</span>
      <span data-testid="tasks-label">{t("tasks")}</span>
      <span data-testid="members-label">{t("members")}</span>
      <span data-testid="workflows-label">{t("workflows")}</span>
      <span data-testid="stages-label">{t("stages")}</span>
      <span data-testid="projects-singular">{ts("projects")}</span>
      <span data-testid="tasks-singular">{ts("tasks")}</span>
    </nav>
  );
}

function Wrapper() {
  return (
    <TerminologyProvider>
      <NavLabels />
    </TerminologyProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TerminologyProvider — invalidation updates nav labels without page reload", () => {
  beforeEach(() => {
    _mockOrgData = null;
  });

  // ── Static rendering ────────────────────────────────────────────────────────

  it("shows default labels when no custom terminology is set", () => {
    _mockOrgData = buildOrg({});
    render(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe(TERM_DEFAULTS.projects);
    expect(screen.getByTestId("tasks-label").textContent).toBe(TERM_DEFAULTS.tasks);
    expect(screen.getByTestId("members-label").textContent).toBe(TERM_DEFAULTS.members);
    expect(screen.getByTestId("workflows-label").textContent).toBe(TERM_DEFAULTS.workflows);
    expect(screen.getByTestId("stages-label").textContent).toBe(TERM_DEFAULTS.stages);
  });

  it("shows custom plural labels from org data on first render", () => {
    _mockOrgData = buildOrg({ projects: "Services", tasks: "Tickets", members: "Agents" });
    render(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe("Services");
    expect(screen.getByTestId("tasks-label").textContent).toBe("Tickets");
    expect(screen.getByTestId("members-label").textContent).toBe("Agents");
  });

  it("falls back to defaults when org data is null (loading state)", () => {
    _mockOrgData = null;
    render(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe(TERM_DEFAULTS.projects);
    expect(screen.getByTestId("tasks-label").textContent).toBe(TERM_DEFAULTS.tasks);
  });

  // ── Singular derivation ─────────────────────────────────────────────────────

  it("auto-derives singular from plural when no override is set", () => {
    _mockOrgData = buildOrg({ projects: "Initiatives", tasks: "Issues" });
    render(<Wrapper />);

    // "Initiatives" → strip trailing "s" → "Initiative"
    expect(screen.getByTestId("projects-singular").textContent).toBe("Initiative");
    // "Issues" → strip trailing "s" → "Issue"
    expect(screen.getByTestId("tasks-singular").textContent).toBe("Issue");
  });

  it("uses the explicit singular override from org when provided", () => {
    _mockOrgData = buildOrg({ tasks: "Tickets", tasksSingular: "Request" });
    render(<Wrapper />);

    expect(screen.getByTestId("tasks-singular").textContent).toBe("Request");
  });

  // ── Invalidation chain (re-render after cache update) ───────────────────────
  //
  // These tests prove that when useGetMyOrg() returns new data — which is
  // exactly what happens after queryClient.invalidateQueries(getGetMyOrgQueryKey())
  // resolves with fresh data from the server — TerminologyProvider propagates
  // the updated values to all consumers on the next render, without a page reload.

  it("updates nav labels when useGetMyOrg returns new terminology (invalidation chain)", () => {
    // Initial state: default terminology
    _mockOrgData = buildOrg({});
    const { rerender } = render(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe(TERM_DEFAULTS.projects);
    expect(screen.getByTestId("tasks-label").textContent).toBe(TERM_DEFAULTS.tasks);

    // Cache updated — simulates what happens after
    //   queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() })
    // causes useGetMyOrg() to return fresh data.
    _mockOrgData = buildOrg({ projects: "Initiatives", tasks: "Issues" });
    rerender(<Wrapper />);

    // Nav labels must reflect the new terminology immediately, no reload
    expect(screen.getByTestId("projects-label").textContent).toBe("Initiatives");
    expect(screen.getByTestId("tasks-label").textContent).toBe("Issues");
    // Unchanged key retains its previous value
    expect(screen.getByTestId("members-label").textContent).toBe(TERM_DEFAULTS.members);
  });

  it("reverts labels to defaults when terminology is cleared (reset-to-defaults flow)", () => {
    // Start with custom labels
    _mockOrgData = buildOrg({ projects: "Epics", tasks: "Requests" });
    const { rerender } = render(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe("Epics");
    expect(screen.getByTestId("tasks-label").textContent).toBe("Requests");

    // User hits "Reset to defaults" and saves — server clears the custom terms
    _mockOrgData = buildOrg({});
    rerender(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe(TERM_DEFAULTS.projects);
    expect(screen.getByTestId("tasks-label").textContent).toBe(TERM_DEFAULTS.tasks);
  });

  it("updates all five nav labels in one invalidation pass", () => {
    _mockOrgData = buildOrg({});
    const { rerender } = render(<Wrapper />);

    _mockOrgData = buildOrg({
      projects: "Services",
      tasks: "Tickets",
      members: "Agents",
      workflows: "Pipelines",
      stages: "Steps",
    });
    rerender(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe("Services");
    expect(screen.getByTestId("tasks-label").textContent).toBe("Tickets");
    expect(screen.getByTestId("members-label").textContent).toBe("Agents");
    expect(screen.getByTestId("workflows-label").textContent).toBe("Pipelines");
    expect(screen.getByTestId("stages-label").textContent).toBe("Steps");
  });

  it("updates the singular override when the cache changes (invalidation chain)", () => {
    // Auto-derived singular from initial custom plural
    _mockOrgData = buildOrg({ tasks: "Tickets" });
    const { rerender } = render(<Wrapper />);

    expect(screen.getByTestId("tasks-singular").textContent).toBe("Ticket");

    // Admin adds an explicit singular override and saves
    _mockOrgData = buildOrg({ tasks: "Tickets", tasksSingular: "Request" });
    rerender(<Wrapper />);

    // Singular override is now active — no reload required
    expect(screen.getByTestId("tasks-singular").textContent).toBe("Request");
  });

  it("transitions from custom label back to default when terminology is partially cleared", () => {
    _mockOrgData = buildOrg({ projects: "Initiatives", tasks: "Requests" });
    const { rerender } = render(<Wrapper />);

    // Only projects is cleared; tasks retains its custom value
    _mockOrgData = buildOrg({ tasks: "Requests" });
    rerender(<Wrapper />);

    expect(screen.getByTestId("projects-label").textContent).toBe(TERM_DEFAULTS.projects);
    expect(screen.getByTestId("tasks-label").textContent).toBe("Requests");
  });
});

// ── singularize() helper — English rules ──────────────────────────────────────

describe("singularize() — English singular derivation helper", () => {
  // The i18n instance initialises with English, so singularize() applies its
  // English rules (i18n.language starts with 'en' in the jsdom test environment).

  it("strips trailing 's' from a regular plural", () => {
    expect(singularize("Tasks")).toBe("Task");
    expect(singularize("Projects")).toBe("Project");
    expect(singularize("Members")).toBe("Member");
    expect(singularize("Stages")).toBe("Stage");
  });

  it("converts '…ies' plurals to '…y'", () => {
    expect(singularize("Factories")).toBe("Factory");
    expect(singularize("Categories")).toBe("Category");
    expect(singularize("Deliveries")).toBe("Delivery");
  });

  it("strips 'es' from '…ses' endings", () => {
    expect(singularize("Statuses")).toBe("Status");
    expect(singularize("Processes")).toBe("Process");
  });

  it("strips 'es' from '…ches' endings", () => {
    expect(singularize("Batches")).toBe("Batch");
    expect(singularize("Patches")).toBe("Patch");
  });

  it("strips 'es' from '…shes' endings", () => {
    expect(singularize("Flashes")).toBe("Flash");
    expect(singularize("Refreshes")).toBe("Refresh");
  });

  it("returns the label unchanged when it does not end in 's' (non-plural forms)", () => {
    // e.g. "Staff" or "Work Item" — no trailing 's', return as-is
    expect(singularize("Staff")).toBe("Staff");
    expect(singularize("Work Item")).toBe("Work Item");
  });

  it("handles Tickets → Ticket correctly", () => {
    expect(singularize("Tickets")).toBe("Ticket");
  });

  it("handles Issues → Issue correctly", () => {
    expect(singularize("Issues")).toBe("Issue");
  });

  it("handles Workflows → Workflow correctly", () => {
    expect(singularize("Workflows")).toBe("Workflow");
  });

  it("handles Initiatives → Initiative correctly (strip trailing s, not -ies rule)", () => {
    // "Initiatives" ends in "es" but not "ies", "ses", "zes", "ches", or "shes",
    // so the plain '…s' → strip-s rule applies → "Initiative"
    expect(singularize("Initiatives")).toBe("Initiative");
  });
});
