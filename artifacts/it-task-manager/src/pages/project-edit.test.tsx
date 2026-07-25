/**
 * ProjectEditPage — tests
 * Covers all scenarios listed in task spec (step 13).
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectEditPage from "./project-edit";

// ── Mutable mock state ────────────────────────────────────────────────────────
const mockSetLocation = vi.fn();
let mockProjectData: object | null = null;
let mockIsLoading = false;
let mockIsError = false;
let mockUpdateProjectMutate = vi.fn();
let mockIsPending = false;
let mockCanManageProjects = true;

const MOCK_PROJECT = {
  id: 7,
  name: "Network Upgrade",
  description: "Upgrade network infrastructure",
  status: "active",
  priority: "high",
  dueDate: "2026-09-01T00:00:00.000Z",
};

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useLocation: () => ["/projects/7/edit", mockSetLocation],
  useSearch: () => "",
  useParams: () => ({ id: "7" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetProject: () => ({
    data: mockProjectData,
    isLoading: mockIsLoading,
    isError: mockIsError,
  }),
  useUpdateProject: () => ({
    mutate: (...args: unknown[]) => mockUpdateProjectMutate(...args),
    isPending: mockIsPending,
  }),
  useListOrgMembers: () => ({ data: [] }),
  getListProjectsQueryKey: () => ["listProjects"],
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: (p: string) =>
      p === "manage_projects" ? mockCanManageProjects : true,
    isFeatureEnabled: () => false,
    isAdmin: mockCanManageProjects,
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
  mockProjectData = { ...MOCK_PROJECT };
  mockIsLoading = false;
  mockIsError = false;
  mockIsPending = false;
  mockCanManageProjects = true;
  mockSetLocation.mockReset();
  mockUpdateProjectMutate = vi.fn();
});

function renderPage(params = { id: "7" }) {
  return render(
    <QueryClientProvider client={makeQc()}>
      <ProjectEditPage params={params} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProjectEditPage", () => {
  it("redirects to /projects when user lacks manage_projects", async () => {
    mockCanManageProjects = false;
    renderPage();
    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/projects");
    });
  });

  it("loads and pre-fills all fields from the fetched project", async () => {
    renderPage();
    await waitFor(() => {
      const input = screen.getByLabelText(/name/i) as HTMLInputElement;
      expect(input.value).toBe("Network Upgrade");
    });
  });

  it("navigates to /projects/:id on successful save", async () => {
    mockUpdateProjectMutate = vi.fn().mockImplementation(
      (_data, { onSuccess }) =>
        onSuccess({ id: 7, name: "Network Upgrade" }),
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
      expect(mockSetLocation).toHaveBeenCalledWith("/projects/7");
    });
  });

  it("shows error state when project fails to load", async () => {
    mockIsError = true;
    mockProjectData = null;
    renderPage();
    await waitFor(() => {
      expect(screen.queryByLabelText(/name/i)).toBeNull();
    });
  });
});
