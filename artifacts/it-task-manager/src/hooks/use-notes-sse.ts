import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Opens a persistent SSE connection to /api/notes/events and invalidates all
 * notes-related React Query cache entries whenever the server broadcasts a
 * `notes-changed` event.
 *
 * Mount this once inside the org-authenticated tree so visibility changes and
 * content edits made by any org member propagate immediately to every open tab
 * or session without polling.
 */
export function useNotesSSE() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/notes/events", { withCredentials: true });

    const handleMessage = () => {
      // Invalidate every query whose key starts with "/notes" — this covers
      // both getListNotesQueryKey() → ["/notes", params]
      // and    getGetNoteQueryKey(id) → ["/notes/{id}"]
      queryClient.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return typeof first === "string" && first.startsWith("/notes");
        },
      });
    };

    es.addEventListener("message", handleMessage);

    return () => {
      es.removeEventListener("message", handleMessage);
      es.close();
    };
  }, [queryClient]);
}
