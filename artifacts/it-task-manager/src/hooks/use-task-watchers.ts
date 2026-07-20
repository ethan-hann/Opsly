/**
 * Thin hooks for the task-watcher endpoints.
 *
 * Calls the API using the same BASE_URL pattern as the rest of the app.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface WatcherInfo {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
}

export interface TaskWatchersData {
  count: number;
  isWatching: boolean;
  watchers: WatcherInfo[];
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

export function taskWatchersQueryKey(taskId: number) {
  return ["taskWatchers", taskId] as const;
}

export function useGetTaskWatchers(taskId: number) {
  return useQuery<TaskWatchersData>({
    queryKey: taskWatchersQueryKey(taskId),
    queryFn: () => apiFetch<TaskWatchersData>(`/api/tasks/${taskId}/watchers`),
    enabled: !!taskId,
  });
}

export function useWatchTask(taskId: number) {
  const queryClient = useQueryClient();
  return useMutation<{ watching: true }, Error, void>({
    mutationFn: () =>
      apiFetch<{ watching: true }>(`/api/tasks/${taskId}/watch`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskWatchersQueryKey(taskId) });
    },
  });
}

export function useUnwatchTask(taskId: number) {
  const queryClient = useQueryClient();
  return useMutation<{ watching: false }, Error, void>({
    mutationFn: () =>
      apiFetch<{ watching: false }>(`/api/tasks/${taskId}/watch`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskWatchersQueryKey(taskId) });
    },
  });
}
