/**
 * Shared QueryClient instance + IndexedDB cache persistence.
 *
 * Extracted from App.tsx so that main.tsx can restore the persisted cache
 * from IndexedDB BEFORE the first React render, ensuring dropdowns and other
 * query-driven UI are populated immediately when the app loads offline.
 *
 * Flow:
 *   main.tsx  →  restoreQueryCache()  →  render(<App />)
 *   App.tsx   →  <QueryClientProvider client={queryClient}>
 *   main.tsx  →  startQueryCachePersistence()  (subscribe + debounce-write)
 */

import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { get, set } from "idb-keyval";

// ---------------------------------------------------------------------------
// QueryClient
// ---------------------------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? (error as { status?: number }).status
            : undefined;
        if (typeof status === "number" && status >= 400 && status <= 499) return false;
        return failureCount < 3;
      },
      // Keep unused entries for 30 min so the in-memory cache survives
      // short offline sessions without a page refresh.
      gcTime: 30 * 60 * 1000,
      refetchInterval: 8_000,
      refetchIntervalInBackground: false,
      // 'online' pauses queries when offline and returns cached data instead
      // of firing and erroring (which was wiping dropdown / form data).
      networkMode: "online",
    },
    mutations: {
      // 'offlineFirst' lets mutations fire when offline so customFetch can
      // intercept the TypeError and queue them in IndexedDB.
      networkMode: "offlineFirst",
    },
  },
});

// Resume paused mutations and re-fetch stale data when connectivity returns.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    queryClient.resumePausedMutations();
    queryClient.invalidateQueries();
  });
}

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

const CACHE_KEY = "rq-offline-cache";
/** How long the persisted snapshot is considered valid (24 hours). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PersistedCache {
  state: ReturnType<typeof dehydrate>;
  timestamp: number;
}

/**
 * Load the last-saved React Query cache from IndexedDB and hydrate it into
 * the shared QueryClient.  Call this before the first render so that
 * query-driven UI (dropdowns, lists) is populated immediately on load.
 *
 * Silently no-ops when the cache is absent, expired, or unreadable.
 */
export async function restoreQueryCache(): Promise<void> {
  try {
    const persisted = await get<PersistedCache>(CACHE_KEY);
    if (!persisted) return;
    if (Date.now() - persisted.timestamp > MAX_AGE_MS) return;
    hydrate(queryClient, persisted.state);
  } catch {
    // A corrupt or missing snapshot is not an error — the app just fetches fresh.
  }
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    try {
      // dehydrate() only captures queries with status === 'success',
      // so we never persist loading/error states.
      const state = dehydrate(queryClient);
      await set(CACHE_KEY, { state, timestamp: Date.now() } satisfies PersistedCache);
    } catch {
      // Persist failures are non-fatal — the app still works, just without
      // the offline snapshot.
    }
  }, 1_000);
}

/**
 * Subscribe to QueryCache changes and debounce-persist the dehydrated state
 * to IndexedDB.  Returns an unsubscribe function.
 *
 * Call this once after the app has rendered.
 */
export function startQueryCachePersistence(): () => void {
  const unsubscribe = queryClient.getQueryCache().subscribe(scheduleSave);
  return () => {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = null;
    unsubscribe();
  };
}
