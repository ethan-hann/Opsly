import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineQueue } from "@/hooks/use-offline-queue";

/**
 * Sticky amber banner that appears at the top of the screen when the device
 * goes offline, showing how many mutations are queued.
 *
 * On mount it flushes any mutations that were queued during a previous offline
 * session (i.e. the user closed the app while offline and reopened online).
 * When connectivity is restored it also flushes the queue; the flush itself
 * shows a sonner toast confirming how many changes were synced.
 */
export function OfflineBanner() {
  const { isOnline, isOffline } = useNetworkStatus();
  const { queueLength, flushQueue } = useOfflineQueue();
  const wasOffline = useRef(isOffline);

  // Flush any mutations queued in a previous session on startup.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine) {
      flushQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush when connectivity is restored after being offline.
  useEffect(() => {
    if (wasOffline.current && isOnline) {
      flushQueue();
    }
    wasOffline.current = isOffline;
  }, [isOnline, isOffline, flushQueue]);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "sticky top-0 z-10 w-full flex items-center justify-center gap-2 px-4 py-2",
        "bg-amber-500 text-amber-950 text-sm font-medium shadow-md",
        "transition-transform duration-300",
      ].join(" ")}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>You&apos;re offline</span>
      {queueLength > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-amber-800 text-amber-50 text-xs font-semibold px-2 py-0.5 min-w-[1.5rem]"
          aria-label={`${queueLength} ${queueLength === 1 ? "change" : "changes"} queued`}
        >
          {queueLength} {queueLength === 1 ? "change" : "changes"} queued
        </span>
      )}
    </div>
  );
}
