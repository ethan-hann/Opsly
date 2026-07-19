import { pgTable, text, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./auth";

/**
 * Org-wide task templates that pre-fill the task creation form.
 * Admins manage templates; any member can use them.
 */
export const taskTemplatesTable = pgTable("task_templates", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Default task title (plain text). May contain placeholders like [SERVICE]. */
  defaultTitle: text("default_title").notNull().default(""),
  /** Default task priority: low | medium | high | critical */
  defaultPriority: varchar("default_priority", { length: 16 }).notNull().default("medium"),
  /** Default task category: incident | change | maintenance | deployment | support | other */
  defaultCategory: varchar("default_category", { length: 32 }).notNull().default("other"),
  /** Default task description / runbook steps (plain text or rich-text HTML) */
  defaultDescription: text("default_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TaskTemplate = typeof taskTemplatesTable.$inferSelect;
export type InsertTaskTemplate = typeof taskTemplatesTable.$inferInsert;
