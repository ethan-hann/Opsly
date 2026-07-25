import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfflineBanner } from "./offline-banner";

// Mock the hooks so we control network status and queue length.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: vi.fn(),
}));

vi.mock("@/hooks/use-offline-queue", () => ({
  useOfflineQueue: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// draft-notes uses idb-keyval (IndexedDB), which is not available in JSDOM.
// The offline-banner calls flushDraftNotes() directly, so we stub it out.
vi.mock("@/lib/draft-notes", () => ({
  flushDraftNotes: vi.fn().mockResolvedValue([]),
  saveDraft: vi.fn().mockResolvedValue(undefined),
  loadDrafts: vi.fn().mockResolvedValue([]),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
}));

import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineQueue } from "@/hooks/use-offline-queue";

const mockUseNetworkStatus = vi.mocked(useNetworkStatus);
const mockUseOfflineQueue = vi.mocked(useOfflineQueue);

function makeQueueMock(queueLength = 0) {
  return {
    queueLength,
    addToQueue: vi.fn(),
    flushQueue: vi.fn().mockResolvedValue(undefined),
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: online
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
  });

  it("is not in the document when online with an empty queue", () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: true, isOffline: false });
    mockUseOfflineQueue.mockReturnValue(makeQueueMock(0));

    const { container } = render(<OfflineBanner />, { wrapper: Wrapper });
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
  });

  it("shows wifi-off icon and 'You're offline' text when isOffline is true", () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue(makeQueueMock(0));

    render(<OfflineBanner />, { wrapper: Wrapper });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
  });

  it("shows '3 changes queued' badge when queueLength is 3", () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue(makeQueueMock(3));

    render(<OfflineBanner />, { wrapper: Wrapper });

    expect(screen.getByText(/3 changes queued/i)).toBeInTheDocument();
  });

  it("shows '1 change queued' (singular) when queueLength is 1", () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue(makeQueueMock(1));

    render(<OfflineBanner />, { wrapper: Wrapper });

    expect(screen.getByText(/1 change queued/i)).toBeInTheDocument();
  });

  it("does not show a badge when queue is empty while offline", () => {
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue(makeQueueMock(0));

    render(<OfflineBanner />, { wrapper: Wrapper });

    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument();
  });

  it("calls flushQueue when transitioning from offline to online", async () => {
    const flushQueue = vi.fn().mockResolvedValue(undefined);
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue({ queueLength: 2, addToQueue: vi.fn(), flushQueue });

    const { rerender } = render(<OfflineBanner />, { wrapper: Wrapper });

    // Now go online
    mockUseNetworkStatus.mockReturnValue({ isOnline: true, isOffline: false });

    await act(async () => {
      rerender(<OfflineBanner />);
    });

    expect(flushQueue).toHaveBeenCalled();
  });

  it("calls flushQueue on mount when navigator.onLine is true (startup replay of persisted queue)", async () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
    const flushQueue = vi.fn().mockResolvedValue(undefined);
    mockUseNetworkStatus.mockReturnValue({ isOnline: true, isOffline: false });
    mockUseOfflineQueue.mockReturnValue({ queueLength: 0, addToQueue: vi.fn(), flushQueue });

    await act(async () => {
      render(<OfflineBanner />, { wrapper: Wrapper });
    });

    expect(flushQueue).toHaveBeenCalledTimes(1);
  });

  it("does not call flushQueue on mount when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", { writable: true, value: false });
    const flushQueue = vi.fn().mockResolvedValue(undefined);
    mockUseNetworkStatus.mockReturnValue({ isOnline: false, isOffline: true });
    mockUseOfflineQueue.mockReturnValue({ queueLength: 1, addToQueue: vi.fn(), flushQueue });

    await act(async () => {
      render(<OfflineBanner />, { wrapper: Wrapper });
    });

    // flushQueue should NOT be called on mount when offline
    expect(flushQueue).not.toHaveBeenCalled();
  });
});
