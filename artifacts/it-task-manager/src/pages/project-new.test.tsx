/**
 * ProjectNewPage — tests
 * Covers all scenarios listed in task spec (step 12).
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectNewPage from "./project-new";

// ── Mutable mock state ────────────────────────────────────────────────────────
const mockSetLocation = vi.fn();
let mockCreateProjectMutate = vi.fn();
let mockIsPending = false;
let mockCanManageProjects = true;
let mockTermTs = (key: string) => (key === "projects" ? "Project" : key);

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useLocation: () => ["/projects/new", mockSetLocation],
  useSearch: () => "",
  useParams: () => ({}),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateProject: () => ({
    mutate: (...args: unknown[]) => mockCreateProjectMutate(...args),
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
    ts: (key: string) => mockTermTs(key),
    tSingular: (key: string) => (key === "projects" ? "Project" : key),
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
  mockCanManageProjects = true;
  mockIsPending = false;
  mockSetLocation.mockReset();
  mockCreateProjectMutate = vi.fn();
  mockTermTs = (key: string) => (key === "projects" ? "Project" : key);
});

function renderPage() {
  return render(
    <QueryClientProvider client={makeQc()}>
      <ProjectNewPage />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProjectNewPage", () => {
  it("redirects to /projects when user lacks manage_projects", async () => {
    mockCanManageProjects = false;
    renderPage();
    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/projects");
    });
  });

  it("renders the full form for users with manage_projects", () => {
    mockCanManageProjects = true;
    renderPage();
    expect(screen.getByLabelText(/name/i)).toBeTruthy();
  });

  it("renders breadcrumb and button labels using custom terminology overrides", () => {
    mockTermTs = (key: string) => (key === "projects" ? "Initiative" : key);
    renderPage();
    expect(screen.getAllByText(/initiative/i).length).toBeGreaterThan(0);
  });

  it("on successful save, navigates to the new project's detail page", async () => {
    mockCreateProjectMutate = vi.fn().mockImplementation(
      (_data, { onSuccess }) => onSuccess({ id: 77, name: "My Project" }),
    );
    renderPage();
    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: "My Project" } });
    const submitButton = screen
      .getAllByRole("button")
      .find((b) => /create|save/i.test(b.textContent ?? "") && !/cancel/i.test(b.textContent ?? ""));
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);
    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/projects/77");
    });
  });

  it("displays a validation error when the project name is empty", async () => {
    renderPage();
    const submitButton = screen
      .getAllByRole("button")
      .find((b) => /create|save/i.test(b.textContent ?? "") && !/cancel/i.test(b.textContent ?? ""));
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);
    await waitFor(() => {
      expect(screen.getByText(/required/i)).toBeTruthy();
    });
    expect(mockCreateProjectMutate).not.toHaveBeenCalled();
  });
});
