import { useState, useEffect, useCallback } from "react";
import {
  loadDrafts,
  createDraftNote,
  updateDraftNote,
  deleteDraftNote,
  DRAFTS_CHANGED_EVENT,
  type DraftNote,
} from "@/lib/draft-notes";

export type { DraftNote };

/**
 * Reactive hook over the IDB draft-notes store.
 *
 * - `drafts` re-renders whenever any draft is created, updated, or deleted
 *   (including flushes triggered outside React, e.g. from OfflineBanner).
 * - All mutations are synchronised to IDB and dispatched via DRAFTS_CHANGED_EVENT
 *   so that any other mounted instance of this hook stays consistent.
 */
export function useDraftNotes() {
  const [drafts, setDrafts] = useState<DraftNote[]>([]);

  const sync = useCallback(() => {
    loadDrafts().then(setDrafts);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(DRAFTS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, sync);
  }, [sync]);

  const createDraft = useCallback(
    async (opts: {
      title?: string;
      projectId?: number | null;
      taskId?: number | null;
    }): Promise<DraftNote> => {
      const draft = await createDraftNote(opts);
      // State will also update via DRAFTS_CHANGED_EVENT, but set immediately
      // to avoid a micro-task flicker.
      setDrafts((prev) => [...prev, draft]);
      return draft;
    },
    [],
  );

  const updateDraft = useCallback(
    async (
      draftId: string,
      patch: Partial<
        Pick<DraftNote, "title" | "content" | "visibility" | "projectId" | "taskId">
      >,
    ): Promise<void> => {
      await updateDraftNote(draftId, patch);
      setDrafts((prev) =>
        prev.map((d) =>
          d.draftId === draftId
            ? { ...d, ...patch, updatedAt: new Date().toISOString() }
            : d,
        ),
      );
    },
    [],
  );

  const deleteDraft = useCallback(async (draftId: string): Promise<void> => {
    await deleteDraftNote(draftId);
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
  }, []);

  return { drafts, createDraft, updateDraft, deleteDraft };
}
