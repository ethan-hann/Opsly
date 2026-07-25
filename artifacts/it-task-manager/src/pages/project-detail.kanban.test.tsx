/**
 * Kanban board toggle tests for the project detail page.
 *
 * Covers:
 *  (a) The toggle renders both List and Board buttons.
 *  (b) Switching to Board renders KanbanBoard with the project's tasks.
 *  (c) Switching back to List renders the task list and hides KanbanBoard.
 *  (d) The chosen view mode is saved to / restored from localStorage.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const mockHasPermission = vi.hoisted(() => vi.fn().mockReturnValue(true));

// ---------------------------------------------------------------------------
// localStorage mock — simple in-memory store
// ---------------------------------------------------------------------------
const localStorageStore = vi.hoisted(() => ({} as Record<string, string>));

vi.stubGlobal("localStorage", {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, val: string) => { localStorageStore[key] = val; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
});

// ---------------------------------------------------------------------------
// API hooks
// ---------------------------------------------------------------------------
const mockTasks = [
  {
    id: 1, orgTaskNumber: 1, title: "Task Alpha", status: "1", priority: "medium",
    category: "other", projectId: 99, assignee: null, dueDate: null,
    stageName: "Open", stageColor: "#aaa", stageArchived: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

const mockStages = [
  { id: 1, name: "Open", color: "#3b82f6", archivedAt: null, position: 0, stageType: "open" },
];

vi.mock("@workspace/api-client-react", () => ({
  useGetProject: () => ({
    data: {
      id: 99, name: "Test Project", description: null, status: "active",
      priority: "medium", dueDate: null, taskCount: 1, completedTaskCount: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    isLoading: false,
  }),
  useListTasks: () => ({ data: mockTasks, isLoading: false }),
  useListWorkflowStages: () => ({ data: mockStages, isLoading: false }),
  useUpdateProject: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
  useGetTaskDependencies: () => ({ data: [], isLoading: false }),
  useCreateTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  getListProjectsQueryKey: () => ["projects"],
  useGetProjectSLAPolicies: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useGetSLAPolicies: () => ({ data: [], isLoading: false }),
  useUpsertProjectSLAPolicies: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ---------------------------------------------------------------------------
// KanbanBoard — tracked stub so we can assert it was rendered
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/kanban-board", () => ({
  KanbanBoard: ({ tasks, stages }: { tasks: unknown[]; stages: unknown[] }) => (
    <div
      data-testid="kanban-board"
      data-task-count={tasks.length}
      data-stage-count={stages.length}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Misc mocks
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/edit-project-modal", () => ({
  EditProjectModal: () => null,
}));
vi.mock("@/components/ui/new-task-modal", () => ({
  NewTaskModal: () => null,
}));
vi.mock("@/components/notes/inline-notes", () => ({
  InlineNotes: () => null,
}));
vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: mockHasPermission,
    isFeatureEnabled: vi.fn().mockReturnValue(true),
    isAdmin: true,
    isOwner: false,
    org: { id: "org-1" },
  }),
}));
vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (k: string) => k,
    tSingular: (k: string) => k,
    terminology: {},
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/projects/99", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  formatTimeAgo: () => "just now",
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => null,
  PriorityBadge: () => null,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import ProjectDetail from "./project-detail.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(<ProjectDetail params={{ id: "99" }} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProjectDetail — Kanban board toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    mockHasPermission.mockReturnValue(true);
  });

  it("(a) renders both List and Board toggle buttons in the tasks section", () => {
    renderPage();

    expect(screen.getByTestId("view-toggle-list")).toBeInTheDocument();
    expect(screen.getByTestId("view-toggle-board")).toBeInTheDocument();
  });

  it("(b) switching to Board renders KanbanBoard with the project's tasks", () => {
    renderPage();

    // Initially no board
    expect(screen.queryByTestId("kanban-board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("view-toggle-board"));

    const board = screen.getByTestId("kanban-board");
    expect(board).toBeInTheDocument();
    expect(board.getAttribute("data-task-count")).toBe(String(mockTasks.length));
    expect(board.getAttribute("data-stage-count")).toBe(String(mockStages.length));
  });

  it("(c) switching back to List renders the task list and hides KanbanBoard", () => {
    renderPage();

    fireEvent.click(screen.getByTestId("view-toggle-board"));
    expect(screen.getByTestId("kanban-board")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("view-toggle-list"));
    expect(screen.queryByTestId("kanban-board")).not.toBeInTheDocument();
    // The task title should be visible in the list (getAllByText because the
    // dependency tree section may also render the same title).
    expect(screen.getAllByText("Task Alpha").length).toBeGreaterThan(0);
  });

  it("(d) saves view mode to localStorage when toggled", () => {
    renderPage();

    fireEvent.click(screen.getByTestId("view-toggle-board"));
    expect(localStorage.getItem("project-detail-view-mode")).toBe("board");

    fireEvent.click(screen.getByTestId("view-toggle-list"));
    expect(localStorage.getItem("project-detail-view-mode")).toBe("list");
  });

  it("(d) restores board view from localStorage on mount", () => {
    localStorage.setItem("project-detail-view-mode", "board");
    renderPage();

    expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
    // The task list is hidden in board view; assert the board is present.
    // (Task title may still appear in the dependency tree section, so we do
    // not assert its absence — only that the kanban board is shown.)
  });
});
