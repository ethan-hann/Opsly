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

// ─── Default palette ──────────────────────────────────────────────────────────

/**
 * The 12 built-in emoji that ship with every new org.
 * Matches DEFAULT_REACTION_PALETTE in @workspace/api-zod.
 */
export const DEFAULT_REACTION_PALETTE: string[] = [
  "👍", "👎", "❤️", "😂", "😮", "😢", "🎉", "🙌", "🔥", "✅", "🤔", "👀",
];

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

// ─── Optimistic update helpers ────────────────────────────────────────────────

type WithReactions = { id: number; reactions: ReactionSummaryType[] };

function applyOptimisticAdd(
  old: WithReactions[] | undefined,
  commentId: number,
  emoji: string,
  userId: string | null,
): WithReactions[] | undefined {
  if (!old) return old;
  return old.map((c) => {
    if (c.id !== commentId) return c;
    const existing = c.reactions.find((r) => r.emoji === emoji);
    if (existing) {
      // Already exists — increment count and add userId if not already present
      const alreadyIn = userId ? existing.userIds.includes(userId) : false;
      if (alreadyIn) return c; // No-op: user already reacted
      return {
        ...c,
        reactions: c.reactions.map((r) =>
          r.emoji === emoji
            ? { ...r, count: r.count + 1, userIds: userId ? [...r.userIds, userId] : r.userIds }
            : r
        ),
      };
    }
    // New emoji — add entry
    return {
      ...c,
      reactions: [
        ...c.reactions,
        { emoji, count: 1, userIds: userId ? [userId] : [] },
      ],
    };
  });
}

function applyOptimisticRemove(
  old: WithReactions[] | undefined,
  commentId: number,
  emoji: string,
  userId: string | null,
): WithReactions[] | undefined {
  if (!old) return old;
  return old.map((c) => {
    if (c.id !== commentId) return c;
    return {
      ...c,
      reactions: c.reactions
        .map((r) => {
          if (r.emoji !== emoji) return r;
          const newUserIds = userId ? r.userIds.filter((id) => id !== userId) : r.userIds;
          return { ...r, count: Math.max(0, r.count - 1), userIds: newUserIds };
        })
        .filter((r) => r.count > 0),
    };
  });
}

// ─── Reaction toggle hooks ────────────────────────────────────────────────────

export function useAddReaction(
  commentId: number,
  commentsQueryKey: readonly unknown[],
  currentUserId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, { emoji: string }>({
    mutationFn: (body) =>
      apiFetch<{ ok: true }>(`/api/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onMutate: async ({ emoji }) => {
      const key = commentsQueryKey as unknown[];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: WithReactions[] | undefined) =>
        applyOptimisticAdd(old, commentId, emoji, currentUserId)
      );
      return { previous };
    },
    onError: (_err, _vars, context: { previous?: unknown } | undefined) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(commentsQueryKey as unknown[], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsQueryKey as unknown[] });
    },
  });
}

export function useRemoveReaction(
  commentId: number,
  commentsQueryKey: readonly unknown[],
  currentUserId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, { emoji: string }>({
    mutationFn: ({ emoji }) =>
      apiFetch<{ ok: true }>(`/api/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`, {
        method: "DELETE",
      }),
    onMutate: async ({ emoji }) => {
      const key = commentsQueryKey as unknown[];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: WithReactions[] | undefined) =>
        applyOptimisticRemove(old, commentId, emoji, currentUserId)
      );
      return { previous };
    },
    onError: (_err, _vars, context: { previous?: unknown } | undefined) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(commentsQueryKey as unknown[], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsQueryKey as unknown[] });
    },
  });
}
