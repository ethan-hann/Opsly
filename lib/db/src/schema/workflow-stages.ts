import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Org-defined workflow stages. Replaces the hardcoded task status enum.
 * Each org starts with four seeded defaults (To Do, In Progress, Blocked, Done).
 * Archived stages are hidden from new task creation but preserved for existing tasks.
 */
export const workflowStagesTable = pgTable("workflow_stages", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Hex color code for display, e.g. "#6b7280" */
  color: varchar("color", { length: 7 }).notNull().default("#6b7280"),
  /** "open" — task is unresolved; "closed" — task is resolved (used for SLA & dashboard). */
  type: text("type").notNull().default("open"), // "open" | "closed"
  position: integer("position").notNull().default(0),
  /** When set, stage is archived: hidden from new assignments but existing tasks are preserved. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WorkflowStage = typeof workflowStagesTable.$inferSelect;
export type InsertWorkflowStage = typeof workflowStagesTable.$inferInsert;
