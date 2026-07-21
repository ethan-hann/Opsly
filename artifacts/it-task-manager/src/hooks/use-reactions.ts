/**
 * Hooks for emoji reaction endpoints.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ReactionSummaryType {
  emoji: string;
  count: number;
  userIds: string[];
}

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export function reactionPaletteQueryKey() {
  return ["reactionPalette"] as const;
}

// ─── Palette hooks ────────────────────────────────────────────────────────────

export function useReactionPalette() {
  return useQuery<{ palette: string[] }>({
    queryKey: reactionPaletteQueryKey(),
    queryFn: () => apiFetch<{ palette: string[] }>("/api/orgs/reaction-palette"),
  });
}

export function usePatchReactionPalette() {
  const queryClient = useQueryClient();
  return useMutation<{ palette: string[] }, Error, { palette: string[] }>({
    mutationFn: (body) =>
      apiFetch<{ palette: string[] }>("/api/orgs/reaction-palette", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(reactionPaletteQueryKey(), data);
    },
  });
}

// ─── Reaction toggle hooks ────────────────────────────────────────────────────

export function useAddReaction(commentId: number, commentsQueryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, { emoji: string }>({
    mutationFn: (body) =>
      apiFetch<{ ok: true }>(`/api/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onMutate: async ({ emoji }) => {
      // Optimistic update is handled at the comment list level.
      // We just return the context for rollback.
      return { commentId, emoji };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsQueryKey as unknown[] });
    },
  });
}

export function useRemoveReaction(commentId: number, commentsQueryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, { emoji: string }>({
    mutationFn: ({ emoji }) =>
      apiFetch<{ ok: true }>(`/api/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsQueryKey as unknown[] });
    },
  });
}

