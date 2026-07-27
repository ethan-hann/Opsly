/**
 * ExportCard — SSE live-update tests
 *
 * Confirms that when an `export_ready` notification arrives over the shared
 * SSE stream:
 *   1. The "Your export is ready" download banner appears without a page refresh.
 *   2. The "Preparing your export" spinner disappears at the same time.
 *
 * The approach: mock `useSseEvent` to capture the registered handler, then
 * call it directly inside `act()` to simulate the server pushing an event.
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Capture the SSE notification handler registered by ExportCard.
// ---------------------------------------------------------------------------
let capturedSseHandler: ((data: unknown) => void) | null = null;

vi.mock("@/hooks/use-sse", () => ({
  useSseEvent: (_event: string, handler: (data: unknown) => void) => {
    capturedSseHandler = handler;
  },
}));

// ---------------------------------------------------------------------------
// Stub every hook/context imported by org-settings.tsx that ExportCard
// itself does not use — prevents module-resolution failures.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "admin@example.com", firstName: "Admin", lastName: "User" },
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  // hooks used by other cards in org-settings — return safe empty defaults
  useListOrgMembers: () => ({ data: [], isLoading: false }),
  useListOrgInvitations: () => ({ data: [], isLoading: false }),
  useInviteOrgMember: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelOrgInvitation: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveOrgMember: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrgMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useLeaveOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useListRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutate: vi.fn(), isPending: false }),
  useGetSLAPolicies: () => ({ data: [], isLoading: false }),
  useUpsertSLAPolicies: () => ({ mutate: vi.fn(), isPending: false }),
  useListTaskTemplates: () => ({ data: [], isLoading: false }),
  useCreateTaskTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTaskTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useListWorkflowStages: () => ({ data: [], isLoading: false }),
  useCreateWorkflowStage: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateWorkflowStage: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWorkflowStage: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWorkflowStages: () => ({ mutate: vi.fn(), isPending: false }),
  getListWorkflowStagesQueryKey: () => ["workflowStages"],
  useListApiKeys: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  getListApiKeysQueryKey: () => ["apiKeys"],
  usePatchOrgTerminology: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrgBranding: () => ({ mutate: vi.fn(), isPending: false }),
  getGetMyOrgQueryKey: () => ["myOrg"],
  useGetMyOrg: () => ({
    data: { terminology: {}, primaryColor: null, logoUrl: null },
    isLoading: false,
  }),
}));

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    terminology: {
      projects: "Projects",
      tasks: "Tasks",
      members: "Members",
      workflows: "Workflows",
      stages: "Stages",
    },
  }),
  TERM_DEFAULTS: {
    projects: "Projects",
    tasks: "Tasks",
    members: "Members",
    workflows: "Workflows",
    stages: "Stages",
  },
}));

vi.mock("@/context/branding-context", () => ({
  useBranding: () => ({ primaryColor: null, logoUrl: null }),
}));

vi.mock("@/hooks/use-reactions", () => ({
  useReactionPalette: () => ({ data: { palette: [] }, isLoading: false }),
  usePatchReactionPalette: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: () => true,
    isAdmin: true,
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

vi.mock("@/components/ui/custom-fields-manager", () => ({
  CustomFieldsManager: () => <div data-testid="custom-fields-manager" />,
}));

vi.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/notes/markdown-editor", () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}));

// tanstack/react-query — ExportCard doesn't use it directly, but other cards do
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

// ---------------------------------------------------------------------------
// Import the component under test *after* the mocks are in place.
// ---------------------------------------------------------------------------
import { ExportCard } from "./org-settings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO string that is N hours from now. */
function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

/** Builds a minimal fetch Response for the /api/export/pending endpoint. */
function mockPendingResponse(
  pending: false,
): Promise<Response>;
function mockPendingResponse(
  pending: true,
  opts?: { token?: string; filename?: string; expiresAt?: string },
): Promise<Response>;
function mockPendingResponse(
  pending: boolean,
  opts: { token?: string; filename?: string; expiresAt?: string } = {},
): Promise<Response> {
  const body = pending
    ? {
        pending: true,
        token: opts.token ?? "tok-abc123",
        filename: opts.filename ?? "export-2026.json",
        expiresAt: opts.expiresAt ?? hoursFromNow(1),
      }
    : { pending: false };
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mount-time / reload guard tests
// ---------------------------------------------------------------------------

describe("ExportCard — mount-time pending check (page-reload guard)", () => {
  beforeEach(() => {
    capturedSseHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables the button immediately when the server reports a job is still in progress on mount", async () => {
    // Simulates a page reload while a background export job is still running.
    // The API now returns jobInProgress:true for pending-status jobs so the
    // frontend can restore the disabled state without the user having to
    // wait for the SSE notification (which may have already fired).
    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ pending: false, jobInProgress: true }),
      } as unknown as Response),
    );

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Once the mount effect resolves jobQueued must be true.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /export in progress/i }),
      ).toBeDisabled();
    });

    // The "Preparing your export" notice must also be visible.
    expect(screen.getByText(/preparing your export/i)).toBeInTheDocument();
  });

  it("shows the download banner immediately when a completed export is found on mount", async () => {
    // Simulates a page reload after the export already completed.  The
    // component must display the download banner without waiting for an
    // SSE event — because the event fired before the reload.
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pending: true,
          token: "tok-reload",
          filename: "export-reload.json",
          expiresAt,
        }),
      } as unknown as Response),
    );

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Banner must appear from the mount check alone — no SSE required.
    await waitFor(() => {
      expect(screen.getByText("Your export is ready")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /download export-reload\.json/i }),
    ).toBeInTheDocument();

    // The export button must be enabled (no in-progress state).
    const exportBtns = screen.getAllByRole("button", { name: /download export/i });
    const mainBtn = exportBtns.find((b) => b.textContent?.trim() === "Download export");
    expect(mainBtn).toBeDefined();
    expect(mainBtn).not.toBeDisabled();
  });

  it("leaves the button enabled when no export job exists on mount", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ pending: false }),
      } as unknown as Response),
    );

    global.fetch = fetchMock;

    render(<ExportCard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(
      screen.getByRole("button", { name: /download export/i }),
    ).not.toBeDisabled();
    expect(screen.queryByText("Your export is ready")).not.toBeInTheDocument();
  });

  it("clears jobInProgress and shows the download banner when export_ready SSE fires after a reload", async () => {
    // Full reload + SSE cycle: mount finds an in-progress job → button disabled →
    // SSE export_ready fires → banner appears and button re-enables.
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    const fetchMock = vi.fn()
      // mount-time check: job still running
      .mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ pending: false, jobInProgress: true }),
        } as unknown as Response),
      )
      // SSE handler follow-up check: job now complete
      .mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            pending: true,
            token: "tok-sse",
            filename: "export-sse.json",
            expiresAt,
          }),
        } as unknown as Response),
      );

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Confirm disabled state was restored from mount.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /export in progress/i }),
      ).toBeDisabled();
    });

    // Simulate the SSE notification arriving.
    await act(async () => {
      capturedSseHandler?.({ type: "export_ready" });
    });

    // Button must re-enable and banner must appear.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /export in progress/i }),
      ).not.toBeInTheDocument();
    });

    expect(screen.getByText("Your export is ready")).toBeInTheDocument();
  });
});

describe("ExportCard — export_ready SSE live-update", () => {
  beforeEach(() => {
    capturedSseHandler = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the download banner when an export_ready SSE notification arrives", async () => {
    const expiresAt = hoursFromNow(2);

    // Mount: no pending export on the server yet.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Wait for the mount-time pending check to resolve.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Banner must not be visible before the SSE event arrives.
    expect(screen.queryByText("Your export is ready")).not.toBeInTheDocument();

    // Server now has a completed export — prepare the response for the SSE handler's follow-up fetch.
    fetchMock.mockReturnValueOnce(
      mockPendingResponse(true, {
        token: "tok-abc123",
        filename: "export-2026.json",
        expiresAt,
      }),
    );

    // Fire the export_ready notification — simulates the SSE push from the server.
    await act(async () => {
      capturedSseHandler?.({ type: "export_ready" });
    });

    // The download banner must appear automatically — no navigation required.
    await waitFor(() => {
      expect(screen.getByText("Your export is ready")).toBeInTheDocument();
    });

    // The download button must reference the ready filename.
    expect(
      screen.getByRole("button", { name: /download export-2026\.json/i }),
    ).toBeInTheDocument();
  });

  it("removes the jobQueued spinner when the export_ready SSE notification arrives", async () => {
    const expiresAt = hoursFromNow(1);

    // Mount: no pending export.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Wait for the mount-time pending check.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Simulate a background-job export: POST /api/export → 202.
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 202 } as unknown as Response),
    );

    // Click "Download export" to enter the job-queued state.
    fireEvent.click(screen.getByRole("button", { name: /download export/i }));

    // The "Preparing your export" spinner must appear.
    await waitFor(() => {
      expect(
        screen.getByText(/preparing your export/i),
      ).toBeInTheDocument();
    });

    // Server now has the completed export ready.
    fetchMock.mockReturnValueOnce(
      mockPendingResponse(true, {
        token: "tok-xyz",
        filename: "export-ready.json",
        expiresAt,
      }),
    );

    // Fire the export_ready SSE event.
    await act(async () => {
      capturedSseHandler?.({ type: "export_ready" });
    });

    // Spinner must be gone.
    await waitFor(() => {
      expect(
        screen.queryByText(/preparing your export/i),
      ).not.toBeInTheDocument();
    });

    // The download banner must have taken its place.
    expect(screen.getByText("Your export is ready")).toBeInTheDocument();
  });

  it("button is disabled with 'Export in progress…' label while a background job is queued", async () => {
    // Mount: no pre-existing pending export.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Simulate a background-job export: POST /api/export responds 202.
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 202 } as unknown as Response),
    );

    // Click the export button to enter the queued state.
    const exportButton = screen.getByRole("button", { name: /download export/i });
    expect(exportButton).not.toBeDisabled(); // enabled before queuing

    fireEvent.click(exportButton);

    // While jobQueued=true the button must be disabled and show the in-progress label.
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /export in progress/i });
      expect(btn).toBeDisabled();
    });
  });

  it("button re-enables with 'Download export' label after export_ready SSE fires", async () => {
    const expiresAt = hoursFromNow(1);

    // Mount: no pre-existing pending export.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Enter the queued state via a 202 response.
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 202 } as unknown as Response),
    );
    fireEvent.click(screen.getByRole("button", { name: /download export/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export in progress/i })).toBeDisabled();
    });

    // Server now has the completed export — prepare the pending-check response.
    fetchMock.mockReturnValueOnce(
      mockPendingResponse(true, {
        token: "tok-reopen",
        filename: "export-reopen.json",
        expiresAt,
      }),
    );

    // Fire export_ready — clears jobQueued and sets pendingExport.
    await act(async () => {
      capturedSseHandler?.({ type: "export_ready" });
    });

    // The "Export in progress…" button must be gone — jobQueued was cleared.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /export in progress/i }),
      ).not.toBeInTheDocument();
    });

    // The main export button must now be enabled (not showing the disabled in-progress state).
    // Use exact text "Download export" to distinguish it from the banner's file-specific link.
    const exportBtns = screen.getAllByRole("button", { name: /download export/i });
    const mainExportBtn = exportBtns.find((b) => b.textContent?.trim() === "Download export");
    expect(mainExportBtn).toBeDefined();
    expect(mainExportBtn).not.toBeDisabled();

    // The download banner must also be visible.
    expect(screen.getByText("Your export is ready")).toBeInTheDocument();
  });

  it("does not POST a second export when the button is disabled while a job is already queued", async () => {
    // Mount: no pre-existing pending export.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);

    // Wait for the mount-time /api/export/pending check — that is call #1.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Mock the POST /api/export response as 202 (background job queued).
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 202 } as unknown as Response),
    );

    // First click — valid; triggers the POST and enters jobQueued state.
    fireEvent.click(screen.getByRole("button", { name: /download export/i }));

    // Wait until jobQueued=true: button is disabled and shows in-progress label.
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /export in progress/i });
      expect(btn).toBeDisabled();
    });

    // Fetch has been called twice: once for the pending check, once for the POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Attempt a second click on the now-disabled button.
    // A disabled <button> does not fire its onClick in a real browser; the
    // test confirms the same contract holds here — no additional fetch call.
    const disabledBtn = screen.getByRole("button", { name: /export in progress/i });
    fireEvent.click(disabledBtn);

    // Allow any microtasks/promises to settle.
    await act(async () => {});

    // fetch must still have been called exactly twice — no second POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The button must remain disabled.
    expect(disabledBtn).toBeDisabled();
  });

  it("ignores SSE notifications with a type other than export_ready", async () => {
    // Mount: no pending export.
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockPendingResponse(false));

    global.fetch = fetchMock;

    render(<ExportCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Fire an unrelated notification type — export_ready handler must filter it out.
    await act(async () => {
      capturedSseHandler?.({ type: "task_assigned" });
    });

    // No follow-up fetch and no banner.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Your export is ready")).not.toBeInTheDocument();
  });
});
