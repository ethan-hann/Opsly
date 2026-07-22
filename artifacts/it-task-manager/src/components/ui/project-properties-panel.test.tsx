/**
 * Unit tests for ProjectPropertiesPanel.
 *
 * Covers:
 *  (a) Status select fires the PATCH mutation with the new value.
 *  (b) Priority select fires the PATCH mutation with the new value.
 *  (c) A 500 response triggers a destructive toast.
 *  (d) Without manage_projects permission, read-only badges are shown
 *      and no select triggers are rendered.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Hoisted shared mock state
// ---------------------------------------------------------------------------
const mockHasPermission = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockToast        = vi.hoisted(() => vi.fn());
const mockInvalidate   = vi.hoisted(() => vi.fn());
const mockMutate       = vi.hoisted(() => vi.fn());

// Capture the mutation config so tests can invoke onSuccess / onError.
let capturedOnSuccess: (() => void) | undefined;
let capturedOnError:   (() => void) | undefined;

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useUpdateProject: (cfg: { mutation?: { onSuccess?: () => void; onError?: () => void } }) => {
    capturedOnSuccess = cfg?.mutation?.onSuccess;
    capturedOnError   = cfg?.mutation?.onError;
    return { mutate: mockMutate };
  },
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: mockHasPermission,
    isAdmin: true,
    isOwner: false,
    org: { id: "org-1" },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// Radix Select → native <select> so fireEvent.change works in jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="native-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue:   ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// StatusBadge / PriorityBadge — emit a testid so read-only mode is detectable.
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge:   ({ status }:   { status: string })   => <span data-testid="status-badge"   data-value={status}>{status}</span>,
  PriorityBadge: ({ priority }: { priority: string }) => <span data-testid="priority-badge" data-value={priority}>{priority}</span>,
}));

// Card primitives — pass-through.
vi.mock("@/components/ui/card", () => ({
  Card:        ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader:  ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle:   ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// InlineDueDatePicker — not under test here; stub it out.
vi.mock("@/components/ui/property-panel", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/property-panel")>();
  return {
    ...real,
    InlineDueDatePicker: () => <button data-testid="date-picker">pick date</button>,
  };
});

// ---------------------------------------------------------------------------
// Import component AFTER all mocks
// ---------------------------------------------------------------------------
import { ProjectPropertiesPanel } from "./project-properties-panel.js";
import type { Project } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const BASE_PROJECT: Project = {
  id: 42,
  name: "Test Project",
  status: "active",
  priority: "medium",
  dueDate: null,
  taskCount: 5,
  completedTaskCount: 2,
  createdAt: "2026-01-15T10:00:00.000Z",
  updatedAt: "2026-07-20T08:00:00.000Z",
};

function renderPanel(project: Project = BASE_PROJECT) {
  return render(<ProjectPropertiesPanel project={project} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProjectPropertiesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    capturedOnSuccess = undefined;
    capturedOnError   = undefined;
  });

  // ── (a) Status select fires mutation ─────────────────────────────────────
  describe("(a) status select — fires PATCH mutation with the chosen value", () => {
    it("calls updateProject with the new status when the select changes", () => {
      renderPanel();

      // The first native-select corresponds to the Status row.
      const selects = screen.getAllByTestId("native-select");
      expect(selects.length).toBeGreaterThanOrEqual(1);
      const statusSelect = selects[0];

      fireEvent.change(statusSelect, { target: { value: "completed" } });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate).toHaveBeenCalledWith({
        id: BASE_PROJECT.id,
        data: { status: "completed" },
      });
    });

    it("invalidates the project query on success", () => {
      renderPanel();
      expect(capturedOnSuccess).toBeDefined();

      capturedOnSuccess!();

      expect(mockInvalidate).toHaveBeenCalledWith({
        queryKey: ["getProject", BASE_PROJECT.id],
      });
    });
  });

  // ── (b) Priority select fires mutation ───────────────────────────────────
  describe("(b) priority select — fires PATCH mutation with the chosen value", () => {
    it("calls updateProject with the new priority when the select changes", () => {
      renderPanel();

      // Second native-select is Priority.
      const selects = screen.getAllByTestId("native-select");
      expect(selects.length).toBeGreaterThanOrEqual(2);
      const prioritySelect = selects[1];

      fireEvent.change(prioritySelect, { target: { value: "critical" } });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate).toHaveBeenCalledWith({
        id: BASE_PROJECT.id,
        data: { priority: "critical" },
      });
    });
  });

  // ── (c) Error → destructive toast ────────────────────────────────────────
  describe("(c) PATCH error — fires a destructive toast", () => {
    it("shows a destructive toast when the mutation errors", () => {
      renderPanel();
      expect(capturedOnError).toBeDefined();

      capturedOnError!();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    it("does NOT fire a toast on success", () => {
      renderPanel();

      capturedOnSuccess!();

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  // ── (d) Read-only mode when permission is absent ──────────────────────────
  describe("(d) read-only mode — no manage_projects permission", () => {
    beforeEach(() => {
      mockHasPermission.mockReturnValue(false);
    });

    it("renders no select triggers when the user cannot manage projects", () => {
      renderPanel();
      expect(screen.queryAllByTestId("native-select")).toHaveLength(0);
    });

    it("renders a StatusBadge with the current project status", () => {
      renderPanel();
      const badge = screen.getByTestId("status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-value", BASE_PROJECT.status);
    });

    it("renders a PriorityBadge with the current project priority", () => {
      renderPanel();
      const badge = screen.getByTestId("priority-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-value", BASE_PROJECT.priority);
    });
  });

  // ── Created date row ──────────────────────────────────────────────────────
  describe("Created date row", () => {
    it("displays the date portion of createdAt", () => {
      renderPanel();
      // formatDate is mocked to return its first arg; we pass createdAt.split('T')[0]
      expect(screen.getByText("2026-01-15")).toBeInTheDocument();
    });
  });
});
