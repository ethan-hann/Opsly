/**
 * Permission-gate tests for the Edit Task modal.
 *
 * Asserts that:
 *  - closed-type stages are excluded from the status select when the user
 *    lacks close_tasks
 *  - the status field renders as read-only text (not a select) when the
 *    task is already in a closed stage and the user lacks close_tasks
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Hoisted mock state
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

// Stages: one open, one closed
const MOCK_STAGES = [
  { id: 1, name: "Open", type: "open",   archivedAt: null },
  { id: 2, name: "Done", type: "closed", archivedAt: null },
];

vi.mock("@workspace/api-client-react", () => ({
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useListProjects: () => ({ data: [] }),
  useListOrgMembers: () => ({ data: [] }),
  useListCustomFieldDefinitions: () => ({ data: [] }),
  useListWorkflowStages: () => ({ data: MOCK_STAGES }),
  getListTasksQueryKey: () => ["listTasks"],
  getGetOverdueTasksQueryKey: () => ["getOverdueTasks"],
  getGetDashboardSummaryQueryKey: () => ["getDashboardSummary"],
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => key,
    ts: (key: string) => key,
    tSingular: (key: string) => key,
  }),
  TerminologyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/validate-assignee", () => ({
  validateAssignee: () => null,
}));

// Markdown editor is irrelevant; render a plain textarea proxy
vi.mock("@/components/notes/markdown-editor", () => ({
  MarkdownEditor: ({ value, onChange, placeholder }: any) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  ),
}));

// CustomFieldInputs is irrelevant
vi.mock("@/components/ui/custom-field-inputs", () => ({
  CustomFieldInputs: () => null,
}));

// AssigneeCombobox is irrelevant
vi.mock("@/components/ui/assignee-combobox", () => ({
  AssigneeCombobox: () => null,
}));

import { EditTaskModal } from "./edit-task-modal.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const OPEN_TASK = {
  id: 1,
  title: "Fix server",
  status: "1",
  stageType: "open",
  stageName: "Open",
  priority: "medium" as const,
  category: "incident" as const,
};

const CLOSED_TASK = {
  ...OPEN_TASK,
  status: "2",
  stageType: "closed",
  stageName: "Done",
};

function renderModal(task: typeof OPEN_TASK, qc = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <EditTaskModal open task={task} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EditTaskModal — close_tasks permission gate on status select", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
  });

  it("excludes closed-type stages from the status options when the user lacks close_tasks", () => {
    // Only close_tasks is false; all others true
    mockHasPermission.mockImplementation((key: string) => key !== "close_tasks");

    renderModal(OPEN_TASK);

    // Radix Select renders a hidden native <select aria-hidden="true"> with <option> elements.
    // Use { hidden: true } to reach those options and verify the closed-type stage is absent.
    expect(
      screen.queryByRole("option", { name: "Done", hidden: true }),
    ).not.toBeInTheDocument();
    // The open-type stage option must still be present
    expect(
      screen.getByRole("option", { name: "Open", hidden: true }),
    ).toBeInTheDocument();
  });

  it("renders the status field as read-only text when the task is in a closed stage and the user lacks close_tasks", () => {
    mockHasPermission.mockImplementation((key: string) => key !== "close_tasks");

    renderModal(CLOSED_TASK);

    // The stage name appears as static text inside the read-only div
    expect(screen.getByText("Done")).toBeInTheDocument();

    // The modal has selects for Project, Priority, and Category but NOT for Status
    // (Status is read-only). Radix SelectTrigger renders with role="combobox".
    // With Status as a plain div: 3 comboboxes remain (Project, Priority, Category).
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});
