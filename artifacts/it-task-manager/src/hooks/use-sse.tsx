/**
 * Shared SSE singleton for the IT Task Manager frontend.
 *
 * The server enforces exactly one SSE connection per user. Opening multiple
 * EventSource instances (one per component) causes connection preemption and
 * reconnect loops. This module owns the single connection; components subscribe
 * to specific event types via useSseEvent().
 *
 * Provider: <SseProvider> — place it once inside AuthGuard, above any component
 * that calls useSseEvent().
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type SseListener = (data: unknown) => void;

interface SseContextValue {
  /** Subscribe to a named SSE event type. Returns an unsubscribe function. */
  subscribe: (event: string, listener: SseListener) => () => void;
}

const SseContext = createContext<SseContextValue | null>(null);

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

export function SseProvider({ children }: { children: ReactNode }) {
  // Map of eventType → Set of listeners
  const listenersRef = useRef<Map<string, Set<SseListener>>>(new Map());

  const subscribe = useCallback((event: string, listener: SseListener) => {
    const map = listenersRef.current;
    if (!map.has(event)) map.set(event, new Set());
    map.get(event)!.add(listener);
    return () => {
      map.get(event)?.delete(listener);
    };
  }, []);

  // Single EventSource for the lifetime of the provider.
  useEffect(() => {
    const url = `${BASE}/api/events`;
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function dispatch(event: string, rawData: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        parsed = rawData;
      }
      listenersRef.current.get(event)?.forEach((fn) => {
        try { fn(parsed); } catch { /* ignore listener errors */ }
      });
    }

    function connect() {
      if (!active) return;
      es = new EventSource(url, { withCredentials: true });

      // Forward all known event types to subscribers.
      const KNOWN_EVENTS = ["notification", "role-changed"] as const;
      for (const evt of KNOWN_EVENTS) {
        es.addEventListener(evt, (e: MessageEvent) => {
          dispatch(evt, e.data as string);
        });
      }

      es.onerror = () => {
        es?.close();
        es = null;
        if (active) retryTimeout = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      active = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, []);

  return <SseContext.Provider value={{ subscribe }}>{children}</SseContext.Provider>;
}

/**
 * Subscribe to a specific SSE event type.
 *
 * @param event  SSE event name (e.g. "notification", "role-changed")
 * @param handler  Callback receiving the parsed JSON payload. Must be stable
 *                 (wrap in useCallback) to avoid re-subscribing on every render.
 */
export function useSseEvent(event: string, handler: SseListener) {
  const ctx = useContext(SseContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(event, handler);
  }, [ctx, event, handler]);
}

/** Internal: used by components that need the full context (rare). */
export function useSse(): SseContextValue {
  const ctx = useContext(SseContext);
  if (!ctx) throw new Error("useSse must be used inside <SseProvider>");
  return ctx;
}

// Re-export for convenience; not required for functionality.
export type { SseListener };
