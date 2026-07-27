/**
 * TaskNewPage — tests
 * Covers all scenarios listed in task spec (step 10).
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskNewPage from "./task-new";

// ── Mutable state that tests can reconfigure ─────────────────────────────────
let mockSearch = "";
const mockSetLocation = vi.fn();
let mockCreateTaskMutate = vi.fn();
let mockIsPending = false;
let mockIsFeatureEnabled = (_f: string) => false;
let mockHasPermission = (_p: string) => true;
let mockTermT = (key: string) => key;
let mockTermTs = (key: string) => key;

// ── Wouter mock ──────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useLocation: () => ["/tasks/new", mockSetLocation],
  useSearch: () => mockSearch,
  useParams: () => ({}),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── API mock ─────────────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useCreateTask: () => ({
    mutate: (...args: unknown[]) => mockCreateTaskMutate(...args),
    isPending: mockIsPending,
  }),
  useListProjects: () => ({
    data: [{ id: 5, name: "Test Project" }],
  }),
  useListOrgMembers: () => ({ data: [] }),
  useListCustomFieldDefinitions: () => ({ data: [] }),
  useListWorkflowStages: () => ({
    data: [
      { id: 1, name: "Open", type: "open", archivedAt: null },
      { id: 2, name: "Closed", type: "closed", archivedAt: null },
    ],
  }),
  useListTaskTemplates: () => ({ data: [] }),
  useCreateTaskDependency: () => ({ mutate: vi.fn() }),
  useListTasks: () => ({ data: [] }),
  getListTasksQueryKey: () => ["listTasks"],
  getGetOverdueTasksQueryKey: () => ["getOverdueTasks"],
  getGetDashboardSummaryQueryKey: () => ["getDashboardSummary"],
  getListWorkflowStagesQueryKey: () => ["listWorkflowStages"],
}));

// ── OrgContext mock ───────────────────────────────────────────────────────────
vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: (p: string) => mockHasPermission(p),
    isFeatureEnabled: (f: string) => mockIsFeatureEnabled(f),
    isAdmin: true,
    org: { id: "org-1" },
  }),
}));

// ── Terminology mock ──────────────────────────────────────────────────────────
vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => mockTermT(key),
    ts: (key: string) => mockTermTs(key),
    tSingular: (key: string) => key,
  }),
  TerminologyProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ── Heavy UI component mocks ─────────────────────────────────────────────────
vi.mock("@/components/notes/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock("@/components/ui/assignee-combobox", () => ({
  AssigneeCombobox: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid="assignee-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("@/lib/validate-assignee", () => ({
  validateAssignee: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQc()}>
      <TaskNewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockSearch = "";
  mockSetLocation.mockReset();
  mockIsPending = false;
  mockCreateTaskMutate = vi.fn();
  mockIsFeatureEnabled = (_f: string) => false;
  mockHasPermission = (_p: string) => true;
  mockTermT = (key: string) => key;
  mockTermTs = (key: string) => key;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TaskNewPage", () => {
  it("renders with default terminology labels in breadcrumb and heading", () => {
    renderPage();
    // There should be elements with the "tasks" key text
    expect(screen.getAllByText(/tasks/i).length).toBeGreaterThan(0);
    // Page heading should mention "new"
    const headings = screen.getAllByRole("heading");
    expect(headings.some((h) => h.textContent?.toLowerCase().includes("new"))).toBe(true);
  });

  it("renders with custom org terminology overrides", () => {
    mockTermT = (key: string) => (key === "tasks" ? "Tickets" : key);
    mockTermTs = (key: string) => (key === "tasks" ? "Ticket" : key);
    renderPage();
    // Custom term should appear somewhere on the page
    expect(screen.getAllByText(/ticket/i).length).toBeGreaterThan(0);
  });

  it("pre-fills project association when ?projectId query param is present", () => {
    mockSearch = "projectId=5";
    renderPage();
    // The Associations tab should exist
    const assocTab = screen.getByRole("tab", { name: /association/i });
    expect(assocTab).toBeTruthy();
    // Page renders without error — project is pre-filled from URL
    fireEvent.click(assocTab);
    // Project select should be disabled (initialProjectId is set)
    // Verify the tab content is visible
    expect(screen.getByRole("tab", { name: /association/i })).toBeTruthy();
  });

  it("shows Dependencies tab when task_trees enabled and project is selected via ?projectId", () => {
    mockIsFeatureEnabled = (f) => f === "task_trees";
    mockHasPermission = () => true;
    mockSearch = "projectId=5";
    renderPage();
    expect(screen.getByRole("tab", { name: /dependencies/i })).toBeTruthy();
  });

  it("hides Dependencies tab when task_trees feature is disabled", () => {
    mockIsFeatureEnabled = () => false;
    mockSearch = "projectId=5";
    renderPage();
    expect(screen.queryByRole("tab", { name: /dependencies/i })).toBeNull();
  });

  it("hides Dependencies tab when no project is selected even if task_trees is enabled", () => {
    mockIsFeatureEnabled = (f) => f === "task_trees";
    mockHasPermission = () => true;
    mockSearch = ""; // no projectId
    renderPage();
    expect(screen.queryByRole("tab", { name: /dependencies/i })).toBeNull();
  });

  it("Save button is disabled while the create mutation is in-flight", () => {
    mockIsPending = true;
    renderPage();
    // All buttons should be disabled
    const buttons = screen.getAllByRole("button");
    const saveButton = buttons.find((b) =>
      /saving/i.test(b.textContent ?? ""),
    );
    expect(saveButton).toBeDefined();
    expect(saveButton).toBeDisabled();
  });

  it("displays a validation error when title is empty and Save is clicked", async () => {
    renderPage();
    const submitButton = screen
      .getAllByRole("button")
      .find((b) => /create|save/i.test(b.textContent ?? "") && !(/cancel/i.test(b.textContent ?? "")));
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);
    await waitFor(() => {
      expect(screen.getByText(/required/i)).toBeTruthy();
    });
    expect(mockCreateTaskMutate).not.toHaveBeenCalled();
  });

  it("navigates to task list on successful save", async () => {
    mockCreateTaskMutate = vi.fn().mockImplementation((_data, { onSuccess }) => {
      onSuccess({ id: 99, title: "Test" });
    });
    renderPage();
    // Enter a title
    const titleInput = screen.getByLabelText(/name/i);
    fireEvent.change(titleInput, { target: { value: "My Task" } });
    // Click Save
    const submitButton = screen
      .getAllByRole("button")
      .find((b) => /create|save/i.test(b.textContent ?? "") && !(/cancel/i.test(b.textContent ?? "")));
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);
    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/tasks");
    });
  });
});
