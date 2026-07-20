import {
  pgTable,
  varchar,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./auth";
import { organizationsTable } from "./organizations";

/**
 * Tracks which users are watching a task.
 *
 * Composite PK (taskId, userId) — idempotent upserts simply conflict-skip.
 * Cascade-deletes when the task or user is removed.
 * Org membership is also stored so we can efficiently query "all tasks I watch
 * in org X" without joining tasks.
 */
export const taskWatchersTable = pgTable(
  "task_watchers",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    // Fast watcher-count + watcher list for a task
    index("task_watchers_task_id_idx").on(table.taskId),
    // Fast "tasks I'm watching in this org" query
    index("task_watchers_user_org_idx").on(table.userId, table.orgId),
  ],
);

export type TaskWatcher = typeof taskWatchersTable.$inferSelect;
export type InsertTaskWatcher = typeof taskWatchersTable.$inferInsert;
