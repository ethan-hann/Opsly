import { pgTable, text, serial, timestamp, date, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./auth";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("planning"), // planning | active | on_hold | completed
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  dueDate: date("due_date", { mode: "string" }),
  /** ID of the user who created this project. Null for projects created before this field was added or via API key. */
  createdBy: varchar("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
