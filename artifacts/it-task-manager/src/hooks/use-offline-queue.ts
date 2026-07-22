import { useState, useEffect, useCallback, useRef } from "react";
import { get, set } from "idb-keyval";
import { toast } from "sonner";
import type { OfflineQueueEntry } from "@workspace/api-client-react";

export type { OfflineQueueEntry };

const QUEUE_KEY = "offline-mutation-queue";

/**
 * Custom window event fired whenever an entry is added to the queue outside
 * of the React hook (e.g. via standaloneAddToQueue called from customFetch).
 * Mounted useOfflineQueue instances listen for this to keep their count fresh.
 */
const QUEUE_CHANGE_EVENT = "offline-queue-changed";

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let _fetchImpl: FetchFn = fetch;

/**
 * Override the fetch implementation used when draining the queue.
 * Primarily used in tests to inject mocks.
 */
export function setQueueFetchImpl(fn: FetchFn): void {
  _fetchImpl = fn;
}

async function loadQueue(): Promise<Array<OfflineQueueEntry & { id: string }>> {
  const stored = await get<Array<OfflineQueueEntry & { id: string }>>(QUEUE_KEY);
  return stored ?? [];
}

async function saveQueue(entries: Array<OfflineQueueEntry & { id: string }>): Promise<void> {
  await set(QUEUE_KEY, entries);
}

/**
 * Promise-chain mutex that serialises all enqueue operations.
 *
 * `standaloneAddToQueue` performs a read-modify-write against IndexedDB. If
 * two offline mutations try to enqueue at the same time, both could read the
 * same prior queue state and the later write would silently overwrite the
 * earlier one — dropping a mutation. Chaining every enqueue onto this promise
 * ensures the operations execute one-at-a-time even when called concurrently.
 */
let _enqueueChain: Promise<void> = Promise.resolve();

/**
 * Standalone (non-hook) function that persists a single entry to IndexedDB.
 * Use this outside React (e.g. in main.tsx) to wire setOfflineQueueHandler.
 *
 * Enqueue operations are serialised via an in-memory promise chain so
 * concurrent calls cannot race and overwrite each other.
 *
 * Also dispatches a window event so any mounted useOfflineQueue hook can
 * refresh its reactive count immediately.
 */
export function standaloneAddToQueue(entry: OfflineQueueEntry): Promise<void> {
  _enqueueChain = _enqueueChain.then(async () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const current = await loadQueue();
    await saveQueue([...current, { id, ...entry }]);
    // Notify mounted hooks that the queue has grown.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT));
    }
  });
  return _enqueueChain;
}

/**
 * Hook that manages an offline mutation queue backed by IndexedDB.
 *
 * - `addToQueue`: serialises a failed mutation into IndexedDB.
 * - `flushQueue`: drains the queue by re-running each stored request in FIFO
 *   order; successful entries are removed, failed entries are retained.
 * - `queueLength`: reactive count of pending entries (updates both on hook
 *   operations and on out-of-hook writes via the QUEUE_CHANGE_EVENT).
 */
export function useOfflineQueue() {
  const [queueLength, setQueueLength] = useState<number>(0);
  const isFlushing = useRef(false);

  useEffect(() => {
    function sync() {
      loadQueue().then((q) => setQueueLength(q.length));
    }

    // Initial load from IndexedDB.
    sync();

    // Stay reactive to out-of-hook enqueues (e.g. via customFetch/standaloneAddToQueue).
    window.addEventListener(QUEUE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(QUEUE_CHANGE_EVENT, sync);
  }, []);

  const addToQueue = useCallback(
    async (entry: OfflineQueueEntry): Promise<void> => {
      await standaloneAddToQueue(entry);
      // standaloneAddToQueue dispatches QUEUE_CHANGE_EVENT which triggers sync,
      // but we also update state immediately to avoid a micro-task delay.
      const updated = await loadQueue();
      setQueueLength(updated.length);
    },
    [],
  );

  const flushQueue = useCallback(async (): Promise<void> => {
    // Idempotency guard — do not run multiple flushes in parallel.
    if (isFlushing.current) return;
    isFlushing.current = true;

    try {
      const entries = await loadQueue();
      if (entries.length === 0) return;

      let successCount = 0;
      const remaining: Array<OfflineQueueEntry & { id: string }> = [];

      for (const entry of entries) {
        try {
          const headers: HeadersInit = { ...entry.headers };
          const init: RequestInit = { method: entry.method, headers };
          if (entry.body !== null) init.body = entry.body;

          const response = await _fetchImpl(entry.url, init);
          if (response.ok || (response.status >= 200 && response.status < 300)) {
            successCount++;
          } else {
            // HTTP error (e.g. 500) — keep in queue.
            remaining.push(entry);
          }
        } catch {
          // Network error — keep in queue.
          remaining.push(entry);
        }
      }

      await saveQueue(remaining);
      setQueueLength(remaining.length);

      if (successCount > 0) {
        toast.success(
          `Back online — ${successCount} ${successCount === 1 ? "change" : "changes"} synced`,
        );
      }
    } finally {
      isFlushing.current = false;
    }
  }, []);

  return { queueLength, addToQueue, flushQueue };
}
