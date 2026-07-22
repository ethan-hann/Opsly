import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock idb-keyval before importing the hook
vi.mock("idb-keyval", () => {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    del: vi.fn(async (key: string) => {
      delete store[key];
    }),
    // Expose store for test inspection
    __resetStore: () => {
      store = {};
    },
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { useOfflineQueue, setQueueFetchImpl, standaloneAddToQueue } from "./use-offline-queue";
import * as idb from "idb-keyval";
import { toast } from "sonner";

const resetStore = (idb as any).__resetStore as () => void;

describe("useOfflineQueue", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    // Reset fetch impl to default
    setQueueFetchImpl(fetch);
  });

  it("starts with queueLength 0 when the store is empty", async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));
  });

  it("addToQueue serialises the entry and increments queueLength", async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    await act(async () => {
      await result.current.addToQueue({
        method: "POST",
        url: "/api/tasks",
        body: JSON.stringify({ title: "Test" }),
        headers: { "content-type": "application/json" },
        timestamp: Date.now(),
      });
    });

    expect(result.current.queueLength).toBe(1);
    expect(idb.set).toHaveBeenCalled();
  });

  it("flushQueue drains entries in FIFO order calling fetch once per entry", async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(url as string);
      return new Response(null, { status: 200 });
    });
    setQueueFetchImpl(mockFetch);

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    // Add two entries
    await act(async () => {
      await result.current.addToQueue({
        method: "POST",
        url: "/api/tasks/1",
        body: null,
        headers: {},
        timestamp: 1000,
      });
      await result.current.addToQueue({
        method: "POST",
        url: "/api/tasks/2",
        body: null,
        headers: {},
        timestamp: 2000,
      });
    });

    expect(result.current.queueLength).toBe(2);

    await act(async () => {
      await result.current.flushQueue();
    });

    // Called in FIFO order
    expect(calls).toEqual(["/api/tasks/1", "/api/tasks/2"]);
    expect(result.current.queueLength).toBe(0);
  });

  it("entries that succeed are removed from the queue", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    setQueueFetchImpl(mockFetch);

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    await act(async () => {
      await result.current.addToQueue({
        method: "POST",
        url: "/api/comments",
        body: '{"text":"hi"}',
        headers: {},
        timestamp: Date.now(),
      });
    });

    await act(async () => {
      await result.current.flushQueue();
    });

    expect(result.current.queueLength).toBe(0);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("1 change synced"),
    );
  });

  it("entries that still fail (server 500) are kept in the queue", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));
    setQueueFetchImpl(mockFetch);

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    await act(async () => {
      await result.current.addToQueue({
        method: "PATCH",
        url: "/api/tasks/99",
        body: '{"status":"closed"}',
        headers: {},
        timestamp: Date.now(),
      });
    });

    await act(async () => {
      await result.current.flushQueue();
    });

    // Entry stays in queue because the server returned 500
    expect(result.current.queueLength).toBe(1);
    // No success toast fired
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("entries that network-fail are kept in the queue", async () => {
    const mockFetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    setQueueFetchImpl(mockFetch);

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    await act(async () => {
      await result.current.addToQueue({
        method: "POST",
        url: "/api/tasks",
        body: null,
        headers: {},
        timestamp: Date.now(),
      });
    });

    await act(async () => {
      await result.current.flushQueue();
    });

    expect(result.current.queueLength).toBe(1);
  });

  it("calling flushQueue while already flushing does not create duplicate requests (idempotency guard)", async () => {
    let resolveFetch!: () => void;
    const inflight = new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(new Response(null, { status: 200 }));
    });

    const mockFetch = vi.fn(() => inflight);
    setQueueFetchImpl(mockFetch);

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    await act(async () => {
      await result.current.addToQueue({
        method: "POST",
        url: "/api/tasks",
        body: null,
        headers: {},
        timestamp: Date.now(),
      });
    });

    // Start two concurrent flushes
    const p1 = result.current.flushQueue();
    const p2 = result.current.flushQueue(); // should be a no-op

    resolveFetch();
    await act(async () => {
      await Promise.all([p1, p2]);
    });

    // fetch should only have been called once (the second flush was blocked)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("queueLength updates reactively when standaloneAddToQueue fires the window event", async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.queueLength).toBe(0));

    // Call standaloneAddToQueue (simulates customFetch enqueuing out-of-hook)
    await act(async () => {
      await standaloneAddToQueue({
        method: "POST",
        url: "/api/tasks",
        body: null,
        headers: {},
        timestamp: Date.now(),
      });
    });

    // Hook should pick up the change via the window event
    await waitFor(() => expect(result.current.queueLength).toBe(1));
  });

  it("concurrent standaloneAddToQueue calls all persist without overwriting each other", async () => {
    // Fire 5 enqueues concurrently — if there were a read-modify-write race
    // some entries would be lost.  The mutex ensures all 5 are saved.
    await act(async () => {
      await Promise.all([
        standaloneAddToQueue({ method: "POST", url: "/api/a", body: null, headers: {}, timestamp: 1 }),
        standaloneAddToQueue({ method: "POST", url: "/api/b", body: null, headers: {}, timestamp: 2 }),
        standaloneAddToQueue({ method: "POST", url: "/api/c", body: null, headers: {}, timestamp: 3 }),
        standaloneAddToQueue({ method: "POST", url: "/api/d", body: null, headers: {}, timestamp: 4 }),
        standaloneAddToQueue({ method: "POST", url: "/api/e", body: null, headers: {}, timestamp: 5 }),
      ]);
    });

    // All 5 entries must be in IndexedDB — none overwritten.
    const stored = await (idb.get as ReturnType<typeof vi.fn>)("offline-mutation-queue");
    expect(stored).toHaveLength(5);
    const urls = stored.map((e: { url: string }) => e.url);
    expect(urls).toContain("/api/a");
    expect(urls).toContain("/api/b");
    expect(urls).toContain("/api/c");
    expect(urls).toContain("/api/d");
    expect(urls).toContain("/api/e");
  });
});
