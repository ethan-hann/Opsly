import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Keeps every open notes query in sync with the server by polling at a short
 * interval.  This invalidates all React Query cache entries whose key starts
 * with "/notes" (covers both the list and individual note detail queries),
 * which triggers a background refetch for any component that currently has an
 * active subscription to that data.
 *
 * We tried SSE first but the Replit preview proxy does not reliably forward
 * chunked streaming responses, so interval-based invalidation is used instead.
 * The server-side broadcast infrastructure remains in place for environments
 * that do support SSE.
 */

const POLL_INTERVAL_MS = 5_000;

export function useNotesSSE() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidateNotes = () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return typeof first === "string" && first.startsWith("/notes");
        },
      });
    };

    const id = setInterval(invalidateNotes, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient]);
}
