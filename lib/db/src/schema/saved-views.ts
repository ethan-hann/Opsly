import { pgTable, text, serial, timestamp, boolean, varchar, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./auth";

export interface SavedViewFilters {
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  dateFrom?: string;
  dateTo?: string;
  projectFilter?: "all" | "with_project" | "no_project";
  search?: string;
}

export const savedViewsTable = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** JSONB bag of filter values for this view */
  filters: jsonb("filters").$type<SavedViewFilters>().notNull().default({}),
  /** When true, the view is visible to all org members */
  isOrgWide: boolean("is_org_wide").notNull().default(false),
  /** When true, this view loads automatically when navigating to /tasks (personal default per user) */
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SavedView = typeof savedViewsTable.$inferSelect;
export type InsertSavedView = typeof savedViewsTable.$inferInsert;
