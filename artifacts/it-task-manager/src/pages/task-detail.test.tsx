/**
 * Permission-gate tests for the Task Detail page.
 *
 * Asserts that the Delete Task button is absent for a user whose role
 * lacks delete_tasks, and present for a user who has it.
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
    features: {},
    isFeatureEnabled: () => true,
    isFeatureUnsubscribed: () => false,
  }),
}));

const MOCK_TASK = {
  id: 1,
  orgTaskNumber: 1,
  orgId: "org-1",
  title: "Fix the server",
  status: "1",
  stageId: 1,
  stageName: "Open",
  stageColor: "#6b7280",
  stageType: "open",
  stageArchived: false,
  priority: "medium",
  category: "incident",
  projectId: null,
  projectName: null,
  description: null,
  assignee: null,
  dueDate: null,
  slaBreachedAt: null,
  customFields: {},
  commentCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@workspace/api-client-react", () => ({
  useGetTask: () => ({ data: MOCK_TASK, isLoading: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutate: vi.fn(), isPending: false }),
  useListComments: () => ({ data: [] }),
  getListCommentsQueryKey: () => ["listComments"],
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
  useListProjects: () => ({ data: [] }),
  useListCustomFieldDefinitions: () => ({ data: [] }),
  useListTaskEvents: () => ({ data: [] }),
  useListOrgMembers: () => ({ data: [] }),
  useGetSLAPolicies: () => ({ data: [] }),
  useListWorkflowStages: () => ({ data: [{ id: 1, name: "Open", type: "open", archivedAt: null }] }),
  getListTasksQueryKey: () => ["listTasks"],
  getGetOverdueTasksQueryKey: () => ["overdue"],
  getGetDashboardSummaryQueryKey: () => ["dashboard"],
  useGetReferences: () => ({ data: { tasks: [], projects: [] }, isLoading: false }),
  // Task dependency hooks
  useGetTaskDependencies: () => ({ data: [] }),
  useCreateTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@workspace/replit-auth-web", () => ({
  useAuth: () => ({ user: { id: "u1", email: "user@example.com", firstName: "Test", lastName: "User" } }),
}));

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => key,
    ts: (key: string) => key,
    tSingular: (key: string) => key,
  }),
  TerminologyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/tasks/1", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
}));

vi.mock("@/hooks/use-task-watchers", () => ({
  useGetTaskWatchers: () => ({ data: { isWatching: false, count: 0 } }),
  useWatchTask: () => ({ mutate: vi.fn() }),
  useUnwatchTask: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Sub-components that call hooks internally — stub them so they don't
// need their own mock trees.
vi.mock("@/components/notes/inline-notes", () => ({
  InlineNotes: () => <div data-testid="inline-notes" />,
}));

vi.mock("@/components/ui/edit-task-modal", () => ({
  EditTaskModal: () => <div data-testid="edit-task-modal" />,
}));

vi.mock("@/components/ui/sla-badge", () => ({
  SlaBadge: () => null,
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => <span data-testid="status-badge" />,
  PriorityBadge: () => <span data-testid="priority-badge" />,
}));

vi.mock("@/components/notes/markdown-preview", () => ({
  MarkdownPreview: ({ content }: any) => <div>{content}</div>,
}));

vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  formatTimeAgo: () => "just now",
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

import TaskDetail from "./task-detail.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TaskDetail params={{ id: "1" }} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskDetail — delete_tasks permission gate", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
  });

  it("shows the Delete Task button when the user has delete_tasks", () => {
    mockHasPermission.mockReturnValue(true);

    renderPage();

    // The delete button title comes from i18n: "Delete {{task}}" with term mock returning "tasks"
    // resulting in "Delete tasks"
    const deleteBtn = document.querySelector('button[title^="Delete"]');
    expect(deleteBtn).toBeInTheDocument();
  });

  it("hides the Delete Task button when the user lacks delete_tasks", () => {
    // All permissions true except delete_tasks
    mockHasPermission.mockImplementation((key: string) => key !== "delete_tasks");

    renderPage();

    const deleteBtn = document.querySelector('button[title^="Delete"]');
    expect(deleteBtn).not.toBeInTheDocument();
  });
});
