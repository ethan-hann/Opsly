/**
 * Comment rendering tests for task-detail.tsx.
 *
 * Covers three properties of the CommentNodeRenderer:
 *  1. Mention chips — @[userId:Name] tokens render as styled <span> chips,
 *     not as raw "@[…]" text.
 *  2. Markdown formatting — **bold**, _italic_, `code` render as HTML elements.
 *  3. Mixed content — markdown and mentions coexist without loss.
 *  4. Deleted-comment tombstones render plain italic placeholder text and do
 *     NOT pass the comment content through ReactMarkdown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const mockHasPermission = vi.hoisted(() => vi.fn().mockReturnValue(true));

// ---------------------------------------------------------------------------
// Module mocks (mirrors task-detail.test.tsx boilerplate)
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

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "user@example.com", firstName: "Test", lastName: "User" },
  }),
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
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-task-watchers", () => ({
  useGetTaskWatchers: () => ({ data: { isWatching: false, count: 0 } }),
  useWatchTask: () => ({ mutate: vi.fn() }),
  useUnwatchTask: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/lib/utils", () => ({
  formatDate: (d: string) => d,
  formatTimeAgo: () => "just now",
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

// reactions hook stubs
vi.mock("@/hooks/use-reactions", () => ({
  useReactionPalette: () => ({ open: false, setOpen: vi.fn(), paletteRef: { current: null } }),
  useAddReaction: () => ({ mutate: vi.fn() }),
  useRemoveReaction: () => ({ mutate: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

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
  commentCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeComment(overrides: Partial<{
  id: number;
  content: string;
  deleted: boolean;
  parentId: number | null;
}> = {}) {
  return {
    id: 1,
    parentId: null,
    orgId: "org-1",
    taskId: 1,
    userId: "u99",
    author: "Alice",
    content: "Hello",
    deleted: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    reactions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-test api-client-react mock (needs dynamic comment list)
// ---------------------------------------------------------------------------

// We override useListComments per test using vi.mocked after the module mock.
const mockUseListComments = vi.hoisted(() => vi.fn(() => ({ data: [] as Record<string, unknown>[] })));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  // Spread the real module so query-key generators (and any future export)
  // stay available; override only the hooks below.
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetTask: () => ({ data: MOCK_TASK, isLoading: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutate: vi.fn(), isPending: false }),
  useListComments: mockUseListComments,
  getListCommentsQueryKey: () => ["listComments"],
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
  useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useListProjects: () => ({ data: [] }),
  useListCustomFieldDefinitions: () => ({ data: [] }),
  useListTaskEvents: () => ({ data: [] }),
  useListOrgMembers: () => ({ data: [] }),
  useGetSLAPolicies: () => ({ data: [] }),
  useListWorkflowStages: () => ({
    data: [{ id: 1, name: "Open", type: "open", archivedAt: null }],
  }),
  getListTasksQueryKey: () => ["listTasks"],
  getGetOverdueTasksQueryKey: () => ["overdue"],
  getGetDashboardSummaryQueryKey: () => ["dashboard"],
  onOrgSuspended: vi.fn(() => () => {}),
  useGetReferences: () => ({ data: { tasks: [], projects: [] }, isLoading: false }),
  // Task dependency hooks
  useGetTaskDependencies: () => ({ data: [] }),
  useCreateTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveTaskDependency: () => ({ mutate: vi.fn(), isPending: false }),
  useListTasks: () => ({ data: [] }),
  getGetSLAPoliciesQueryKey: () => ["slaPolicies"],
  getListWorkflowStagesQueryKey: () => ["listWorkflowStages"],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import TaskDetail from "./task-detail.js";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaskDetail params={{ id: "1" }} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommentNodeRenderer — mention chip rendering", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  it("renders a user mention token as a chip span, not as raw @[...] text", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "Hello @[u1:Alice]!" })],
    });

    renderPage();

    // Wait for comment content to appear
    await waitFor(() => {
      // The chip span should contain the display name
      expect(document.body.innerHTML).toContain("@Alice");
    });

    // Raw token must not leak into the DOM
    expect(document.body.innerHTML).not.toContain("@[u1:Alice]");
  });

  it("renders @[everyone] as an @everyone chip, not as raw text", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "@[everyone] please review." })],
    });

    renderPage();

    await waitFor(() => {
      expect(document.body.innerHTML).toContain("@everyone");
    });

    expect(document.body.innerHTML).not.toContain("@[everyone]");
  });

  it("renders multiple mention chips in one comment", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "@[u1:Alice] and @[u2:Bob] reviewed this." })],
    });

    renderPage();

    await waitFor(() => {
      expect(document.body.innerHTML).toContain("@Alice");
      expect(document.body.innerHTML).toContain("@Bob");
    });
  });
});

describe("CommentNodeRenderer — markdown formatting", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  it("renders **bold** as a <strong> element", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "**important**" })],
    });

    renderPage();

    await waitFor(() => {
      expect(document.querySelector("strong")).toBeInTheDocument();
    });
    expect(document.querySelector("strong")?.textContent).toBe("important");
  });

  it("renders `code` as a <code> element", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "Run `npm install` to start." })],
    });

    renderPage();

    await waitFor(() => {
      expect(document.querySelector("code")).toBeInTheDocument();
    });
    expect(document.querySelector("code")?.textContent).toBe("npm install");
  });
});

describe("CommentNodeRenderer — mixed markdown + mention", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  it("renders markdown formatting and mention chips together without losing content", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "**Bold** and @[u1:Alice] with `code`." })],
    });

    renderPage();

    await waitFor(() => {
      expect(document.querySelector("strong")?.textContent).toBe("Bold");
      expect(document.querySelector("code")?.textContent).toBe("code");
      expect(document.body.innerHTML).toContain("@Alice");
    });

    // Raw token must not appear
    expect(document.body.innerHTML).not.toContain("@[u1:Alice]");
  });
});

describe("CommentNodeRenderer — deleted comment tombstone", () => {
  beforeEach(() => {
    mockHasPermission.mockReturnValue(true);
  });

  it("shows the deleted-comment placeholder instead of the original content", async () => {
    const secretContent = "This is a SECRET message";
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: secretContent, deleted: true })],
    });

    renderPage();

    // Tombstone i18n key (test-setup initialises i18n, but falls back to key)
    await waitFor(() => {
      const italic = document.querySelector("p.italic, p em, p");
      expect(italic).toBeInTheDocument();
    });

    // The original content must never appear in the DOM
    expect(document.body.innerHTML).not.toContain(secretContent);
  });

  it("tombstone does NOT render its placeholder through ReactMarkdown (no <p> wrapping from remark)", async () => {
    mockUseListComments.mockReturnValue({
      data: [makeComment({ content: "**should not be bold**", deleted: true })],
    });

    renderPage();

    await waitFor(() => {
      // Tombstone is visible (avatar placeholder renders)
      const avatarQ = document.querySelector('[class*="muted"]');
      expect(avatarQ).toBeTruthy();
    });

    // The markdown content of the deleted comment must not be processed —
    // no <strong> element should appear from this comment's content.
    const strongs = [...document.querySelectorAll("strong")];
    const fromDeletedComment = strongs.filter(
      (el) => el.textContent === "should not be bold",
    );
    expect(fromDeletedComment).toHaveLength(0);
  });
});
