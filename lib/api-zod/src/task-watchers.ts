import * as zod from "zod";

// ─── Watch / Unwatch ─────────────────────────────────────────────────────────

export const WatchTaskParams = zod.object({ id: zod.coerce.number().int() });
export const UnwatchTaskParams = zod.object({ id: zod.coerce.number().int() });

export const WatchTaskResponse = zod.object({ watching: zod.literal(true) });
export const UnwatchTaskResponse = zod.object({ watching: zod.literal(false) });

// ─── Watcher list ─────────────────────────────────────────────────────────────

export const GetTaskWatchersParams = zod.object({
  id: zod.coerce.number().int(),
});

export const TaskWatcherInfo = zod.object({
  userId: zod.string(),
  firstName: zod.string().nullable(),
  lastName: zod.string().nullable(),
  email: zod.string().nullable(),
  profileImageUrl: zod.string().nullable(),
});

/**
 * Shape returned by GET /tasks/:id/watchers.
 * `isWatching` is true when the request's session user is in the watcher list.
 */
export const GetTaskWatchersResponse = zod.object({
  count: zod.number().int(),
  isWatching: zod.boolean(),
  watchers: zod.array(TaskWatcherInfo),
});

export type TaskWatcherInfoType = zod.infer<typeof TaskWatcherInfo>;
export type GetTaskWatchersResponseType = zod.infer<typeof GetTaskWatchersResponse>;

// ─── Watching filter ──────────────────────────────────────────────────────────

// Extend the list-tasks params to support a `watching` flag.
// This is a standalone export used by the tasks route; the generated
// ListTasksQueryParams is kept as-is and the route merges them.
export const WatchingFilterParam = zod.object({
  watching: zod
    .string()
    .transform((v) => v === "true")
    .optional(),
});
