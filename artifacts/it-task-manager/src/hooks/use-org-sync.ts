import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSseEvent } from "@/hooks/use-sse";

function getTaskId(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;

  const taskId = Reflect.get(payload, "taskId");
  return typeof taskId === "number" ? taskId : null;
}

export function useOrgSync() {
  const queryClient = useQueryClient();

  const invalidateByPrefix = useCallback((prefix: string) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && first.startsWith(prefix);
      },
    });
  }, [queryClient]);

  const handleTaskChanged = useCallback(() => {
    invalidateByPrefix("/api/tasks");
    invalidateByPrefix("/api/dashboard");
  }, [invalidateByPrefix]);

  const handleTaskScopedCommentChange = useCallback((payload: unknown) => {
    const taskId = getTaskId(payload);

    if (taskId !== null) {
      invalidateByPrefix(`/api/tasks/${taskId}/comments`);
      invalidateByPrefix(`/api/tasks/${taskId}/events`);
      return;
    }

    invalidateByPrefix("/api/tasks");
  }, [invalidateByPrefix]);

  const handleProjectChanged = useCallback(() => {
    invalidateByPrefix("/api/projects");
  }, [invalidateByPrefix]);

  const handleStageChanged = useCallback(() => {
    invalidateByPrefix("/api/workflow-stages");
  }, [invalidateByPrefix]);

  const handleNotesChanged = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && first.startsWith("/notes");
      },
    });
  }, [queryClient]);

  useSseEvent("task-changed", handleTaskChanged);
  useSseEvent("comment-changed", handleTaskScopedCommentChange);
  useSseEvent("reaction-changed", handleTaskScopedCommentChange);
  useSseEvent("project-changed", handleProjectChanged);
  useSseEvent("stage-changed", handleStageChanged);
  useSseEvent("notes-changed", handleNotesChanged);
}
