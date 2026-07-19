import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { organizationsTable } from "./organizations";

/**
 * Immutable audit log of field-level changes to tasks.
 * One row per changed field per PATCH request, plus a synthetic "created" row
 * emitted when a task is first inserted.
 */
export const taskEventsTable = pgTable("task_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  /** ID of the user who made the change. Null for system-generated events. */
  actorId: text("actor_id"),
  /** Display name of the actor at the time of the change. */
  actorName: text("actor_name"),
  /**
   * Which field changed. Special value "created" denotes task creation.
   * Values: "created" | "status" | "priority" | "assignee" | "category" |
   *         "title" | "dueDate" | "projectId"
   */
  field: text("field").notNull(),
  /** Serialized previous value. Null when the field had no prior value. */
  oldValue: text("old_value"),
  /** Serialized new value. Null when the field was cleared. */
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskEvent = typeof taskEventsTable.$inferSelect;
