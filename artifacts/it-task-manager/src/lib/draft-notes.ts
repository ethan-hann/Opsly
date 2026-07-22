/**
 * Offline draft notes — persisted in IndexedDB.
 *
 * When the user creates a note while offline, a DraftNote is stored here
 * instead of queuing a raw HTTP request.  This lets the editor remain fully
 * functional: title and content changes are written to IDB immediately.
 *
 * On reconnect, flushDraftNotes() collapses all edits into a single POST
 * /api/notes call per draft and removes the draft on success.
 */

import { get, set } from "idb-keyval";

export interface DraftNote {
  draftId: string;
  title: string;
  content: string;
  visibility: "private" | "public_read" | "public_write";
  projectId: number | null;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
}

const DRAFTS_KEY = "note-drafts";

/** Dispatched whenever the draft list changes so hooks stay reactive. */
export const DRAFTS_CHANGED_EVENT = "draft-notes-changed";

function dispatch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DRAFTS_CHANGED_EVENT));
  }
}

export async function loadDrafts(): Promise<DraftNote[]> {
  return (await get<DraftNote[]>(DRAFTS_KEY)) ?? [];
}

async function persist(drafts: DraftNote[]): Promise<void> {
  await set(DRAFTS_KEY, drafts);
  dispatch();
}

/** Create a new local draft and save it to IDB. */
export async function createDraftNote(opts: {
  title?: string;
  projectId?: number | null;
  taskId?: number | null;
}): Promise<DraftNote> {
  const now = new Date().toISOString();
  const draft: DraftNote = {
    draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: opts.title ?? "Untitled Note",
    content: "",
    visibility: "private",
    projectId: opts.projectId ?? null,
    taskId: opts.taskId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const current = await loadDrafts();
  await persist([...current, draft]);
  return draft;
}

/** Patch a draft in IDB. Only the provided keys are updated. */
export async function updateDraftNote(
  draftId: string,
  patch: Partial<Pick<DraftNote, "title" | "content" | "visibility" | "projectId" | "taskId">>,
): Promise<void> {
  const current = await loadDrafts();
  const updated = current.map((d) =>
    d.draftId === draftId
      ? { ...d, ...patch, updatedAt: new Date().toISOString() }
      : d,
  );
  await persist(updated);
}

/** Remove a single draft (e.g. after the user deletes it). */
export async function deleteDraftNote(draftId: string): Promise<void> {
  const current = await loadDrafts();
  await persist(current.filter((d) => d.draftId !== draftId));
}

/**
 * POST each pending draft to the server as a single API call per draft,
 * collapsing all title/content edits accumulated while offline.
 *
 * Drafts that are successfully created are removed from IDB immediately.
 * Drafts that fail (network error or non-2xx) are kept for the next flush.
 *
 * Returns the number of drafts successfully synced.
 */
export async function flushDraftNotes(): Promise<number> {
  const drafts = await loadDrafts();
  if (drafts.length === 0) return 0;

  let flushed = 0;
  const remaining: DraftNote[] = [];

  for (const draft of drafts) {
    try {
      const body: Record<string, unknown> = {
        title: draft.title || "Untitled Note",
        content: draft.content,
        visibility: draft.visibility,
      };
      if (draft.projectId !== null) body.projectId = draft.projectId;
      if (draft.taskId !== null) body.taskId = draft.taskId;

      const resp = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        flushed++;
      } else {
        remaining.push(draft);
      }
    } catch {
      // Network error — keep the draft and retry next reconnect
      remaining.push(draft);
    }
  }

  await persist(remaining);
  return flushed;
}
