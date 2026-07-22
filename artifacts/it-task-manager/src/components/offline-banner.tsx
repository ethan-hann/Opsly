import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { flushDraftNotes } from "@/lib/draft-notes";

/**
 * Sticky amber banner that appears at the top of the screen when the device
 * goes offline, showing how many mutations are queued.
 *
 * On mount it flushes any mutations that were queued during a previous offline
 * session (i.e. the user closed the app while offline and reopened online).
 * When connectivity is restored it also flushes the queue; after a successful
 * flush it invalidates all React Query caches so the UI re-fetches and
 * reflects the newly-synced server state.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline, isOffline } = useNetworkStatus();
  const { queueLength, flushQueue } = useOfflineQueue();
  const queryClient = useQueryClient();
  const wasOffline = useRef(isOffline);

  async function doFlush() {
    await flushQueue();
    const drafted = await flushDraftNotes();
    await queryClient.invalidateQueries();
    if (drafted > 0) {
      toast.success(
        `${drafted} draft ${drafted === 1 ? "note" : "notes"} saved`,
      );
    }
  }

  // Flush any mutations / drafts queued in a previous session on startup.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine) {
      doFlush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush when connectivity is restored after being offline, then refresh
  // all cached query data so the UI reflects the replayed mutations.
  useEffect(() => {
    if (wasOffline.current && isOnline) {
      doFlush();
    }
    wasOffline.current = isOffline;
  }, [isOnline, isOffline, flushQueue, queryClient]);

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
      <span>{t("common.youreOffline")}</span>
      {queueLength > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-amber-800 text-amber-50 text-xs font-semibold px-2 py-0.5 min-w-[1.5rem]"
          aria-label={t("common.changesQueued", { count: queueLength })}
        >
          {t("common.changesQueued", { count: queueLength })}
        </span>
      )}
    </div>
  );
}
