/**
 * Unit tests for `useTaskFilters().applyView`.
 *
 * Confirms that calling `applyView` with a SavedView whose filters include the
 * four new fields (watching, slaBreached, overdue, stageType) produces
 * URLSearchParams with the correct keys and values, and that omitting those
 * fields leaves them absent from the resulting params.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SavedView } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Mock wouter so the hook can run outside a Router context.
// We capture whatever setLocation is called with so we can assert on it.
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({ location: "" }));

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => [
    "/tasks",
    (loc: string) => {
      captured.location = loc;
    },
  ],
  Link: ({ children }: any) => children,
}));

// ---------------------------------------------------------------------------
// Mock all API hooks consumed by the page module (none are called by the hook
// under test, but the module imports them at the top level).
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-client-react", () => {
  const noop = () => ({ data: undefined, isLoading: false, error: null });
  const noopMut = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useListTasks: noop,
    useListOrgMembers: noop,
    useListViews: noop,
    useCreateView: noopMut,
    useUpdateView: noopMut,
    useDeleteView: noopMut,
    useGetSLAPolicies: noop,
    useListTaskTemplates: noop,
    useBulkUpdateTasks: noopMut,
    useBulkDeleteTasks: noopMut,
    useListWorkflowStages: noop,
    useListCustomFieldDefinitions: noop,
    getListTasksQueryKey: () => ["tasks"],
    getListViewsQueryKey: () => ["views"],
  };
});

vi.mock("@workspace/replit-auth-web", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({ orgId: "org-1", org: { id: "org-1" } }),
}));

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (k: string) => k,
    tSingular: (k: string) => k,
    terminology: {},
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import the hook under test (after all mocks are registered)
// ---------------------------------------------------------------------------
import { useTaskFilters } from "./tasks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeView(filters: SavedView["filters"]): SavedView {
  return {
    id: 99,
    orgId: "org-1",
    createdBy: "user-1",
    name: "Test View",
    filters,
    isOrgWide: false,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function paramsFrom(search: string) {
  // captured.location is "?key=val&..."
  const qs = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(qs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useTaskFilters — applyView", () => {
  beforeEach(() => {
    captured.location = "";
  });

  it("sets watching=true in URLSearchParams when filter is true", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ watching: true }));
    });

    const params = paramsFrom(captured.location);
    expect(params.get("watching")).toBe("true");
  });

  it("sets slaBreached=true in URLSearchParams when filter is true", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ slaBreached: true }));
    });

    const params = paramsFrom(captured.location);
    expect(params.get("slaBreached")).toBe("true");
  });

  it("sets overdue=true in URLSearchParams when filter is true", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ overdue: true }));
    });

    const params = paramsFrom(captured.location);
    expect(params.get("overdue")).toBe("true");
  });

  it("sets stageType in URLSearchParams when filter is set", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ stageType: "open" }));
    });

    const params = paramsFrom(captured.location);
    expect(params.get("stageType")).toBe("open");
  });

  it("sets all four new fields together correctly", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(
        makeView({
          watching: true,
          slaBreached: true,
          overdue: true,
          stageType: "closed",
        }),
      );
    });

    const params = paramsFrom(captured.location);
    expect(params.get("watching")).toBe("true");
    expect(params.get("slaBreached")).toBe("true");
    expect(params.get("overdue")).toBe("true");
    expect(params.get("stageType")).toBe("closed");
    // viewId must also be set
    expect(params.get("viewId")).toBe("99");
  });

  it("omits watching from URLSearchParams when filter is absent", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ status: "urgent" }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("watching")).toBe(false);
  });

  it("omits slaBreached from URLSearchParams when filter is absent", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ status: "urgent" }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("slaBreached")).toBe(false);
  });

  it("omits overdue from URLSearchParams when filter is absent", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ status: "urgent" }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("overdue")).toBe(false);
  });

  it("omits stageType from URLSearchParams when filter is absent", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ status: "urgent" }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("stageType")).toBe(false);
  });

  it("does not set watching when filter is false", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ watching: false }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("watching")).toBe(false);
  });

  it("does not set slaBreached when filter is false", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ slaBreached: false }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("slaBreached")).toBe(false);
  });

  it("does not set overdue when filter is false", () => {
    const { result } = renderHook(() => useTaskFilters());

    act(() => {
      result.current.applyView(makeView({ overdue: false }));
    });

    const params = paramsFrom(captured.location);
    expect(params.has("overdue")).toBe(false);
  });
});
