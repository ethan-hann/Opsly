/**
 * TaskEditPage — tests
 * Covers all scenarios listed in task spec (step 11).
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskEditPage from "./task-edit";

// ── Mutable mock state ────────────────────────────────────────────────────────
const mockSetLocation = vi.fn();
let mockTaskData: object | null = null;
let mockIsLoading = false;
let mockIsError = false;
let mockUpdateTaskMutate = vi.fn();
let mockIsPending = false;
let mockIsFeatureEnabled = (_f: string) => false;
let mockHasPermission = (_p: string) => true;

const MOCK_TASK = {
  id: 42,
  orgId: "org-1",
  orgTaskNumber: 42,
  title: "Fix the router",
  description: "Needs urgent attention",
  status: "1",
  stageName: "Open",
  stageType: "open",
  priority: "high",
  category: "incident",
  projectId: 5,
  assignee: "alice@example.com",
  dueDate: "2026-08-01T00:00:00.000Z",
  customFields: {},
};

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useLocation: () => ["/tasks/42/edit", mockSetLocation],
  useSearch: () => "",
  useParams: () => ({ id: "42" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  // Spread the real module so query-key generators (and any future export)
  // stay available; override only the hooks below.
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetTask: () => ({
    data: mockTaskData,
    isLoading: mockIsLoading,
    isError: mockIsError,
  }),
  useUpdateTask: () => ({
    mutate: (...args: unknown[]) => mockUpdateTaskMutate(...args),
    isPending: mockIsPending,
  }),
  useListProjects: () => ({ data: [{ id: 5, name: "Test Project" }] }),
  useListOrgMembers: () => ({ data: [] }),
  useListCustomFieldDefinitions: () => ({ data: [] }),
  useListWorkflowStages: () => ({
    data: [
      { id: 1, name: "Open", type: "open", archivedAt: null },
      { id: 2, name: "Done", type: "closed", archivedAt: null },
    ],
  }),
  useCreateTaskDependency: () => ({ mutate: vi.fn() }),
  useDeleteTaskDependency: () => ({ mutate: vi.fn() }),
  useGetTaskDependencies: () => ({ data: [] }),
  useListTasks: () => ({ data: [] }),
  getListTasksQueryKey: () => ["listTasks"],
  getGetOverdueTasksQueryKey: () => ["getOverdueTasks"],
  getGetDashboardSummaryQueryKey: () => ["getDashboardSummary"],
  getGetTaskDependenciesQueryKey: () => ["getTaskDependencies"],
  getListWorkflowStagesQueryKey: () => ["listWorkflowStages"],
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: (p: string) => mockHasPermission(p),
    isFeatureEnabled: (f: string) => mockIsFeatureEnabled(f),
    isAdmin: true,
    org: { id: "org-1" },
  }),
}));

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => key,
    ts: (key: string) => key,
    tSingular: (key: string) => key,
  }),
  TerminologyProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

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

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  mockTaskData = { ...MOCK_TASK };
  mockIsLoading = false;
  mockIsError = false;
  mockIsPending = false;
  mockSetLocation.mockReset();
  mockUpdateTaskMutate = vi.fn();
  mockIsFeatureEnabled = () => false;
  mockHasPermission = () => true;
});

function renderPage(params = { id: "42" }) {
  return render(
    <QueryClientProvider client={makeQc()}>
      <TaskEditPage params={params} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TaskEditPage", () => {
  it("loads and pre-fills title field from the fetched task", async () => {
    renderPage();
    await waitFor(() => {
      const input = screen.getByLabelText(/name/i) as HTMLInputElement;
      expect(input.value).toBe("Fix the router");
    });
  });

  it("status field is editable when user has close_tasks permission", async () => {
    // Activate the Status & Priority tab via Radix pointer event sequence
    mockHasPermission = () => true;
    mockTaskData = { ...MOCK_TASK, stageType: "closed" };
    renderPage();
    const tab = screen.getByRole("tab", { name: /status.*priority/i });
    // Radix Tabs responds to pointerDown rather than plain click
    fireEvent.pointerDown(tab, { button: 0, ctrlKey: false });
    fireEvent.focus(tab);
    fireEvent.click(tab);
    // After activation, status + priority + category = 3 comboboxes in the panel
    await waitFor(
      () => {
        const allCombos = document.querySelectorAll("button[role='combobox']");
        expect(allCombos.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 3000 },
    );
  });

  it("status field is read-only when task is in closed stage and user lacks close_tasks", async () => {
    mockHasPermission = (p) => p !== "close_tasks";
    mockTaskData = { ...MOCK_TASK, stageType: "closed", stageName: "Done" };
    renderPage();
    const tab = screen.getByRole("tab", { name: /status.*priority/i });
    fireEvent.pointerDown(tab, { button: 0, ctrlKey: false });
    fireEvent.focus(tab);
    fireEvent.click(tab);
    // In readOnly mode: only priority + category = 2 comboboxes (status is plain div)
    await waitFor(
      () => {
        const allCombos = document.querySelectorAll("button[role='combobox']");
        expect(allCombos.length).toBeLessThanOrEqual(2);
      },
      { timeout: 3000 },
    );
  });

  it("Dependencies tab is visible when task_trees enabled and task has a project", async () => {
    mockIsFeatureEnabled = (f) => f === "task_trees";
    mockHasPermission = () => true;
    mockTaskData = { ...MOCK_TASK, projectId: 5 };
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /dependencies/i })).toBeTruthy();
    });
  });

  it("Dependencies tab is hidden when task_trees is disabled", () => {
    mockIsFeatureEnabled = () => false;
    renderPage();
    expect(screen.queryByRole("tab", { name: /dependencies/i })).toBeNull();
  });

  it("Dependencies tab is hidden when task has no project even if task_trees is enabled", () => {
    mockIsFeatureEnabled = (f) => f === "task_trees";
    mockHasPermission = () => true;
    mockTaskData = { ...MOCK_TASK, projectId: null };
    renderPage();
    expect(screen.queryByRole("tab", { name: /dependencies/i })).toBeNull();
  });

  it("navigates to /tasks/:id on successful save", async () => {
    mockUpdateTaskMutate = vi.fn().mockImplementation((_data, { onSuccess }) =>
      onSuccess({ id: 42, title: "Fix the router" }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toBeTruthy();
    });
    const submitButton = screen
      .getAllByRole("button")
      .find((b) => /save/i.test(b.textContent ?? "") && !/cancel/i.test(b.textContent ?? ""));
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);
    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/tasks/42");
    });
  });

  it("shows error state when task fails to load", async () => {
    mockIsError = true;
    mockTaskData = null;
    renderPage();
    await waitFor(() => {
      expect(screen.queryByLabelText(/name/i)).toBeNull();
    });
  });
});
