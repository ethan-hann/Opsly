import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

/**
 * SLA targets keyed by (orgId, priority).
 * When projectId is null  → org-level default (applies to all projects).
 * When projectId is set   → project-level override (takes precedence for that project).
 * Upserted via PUT /org/sla-policies (org-level) or PUT /projects/:id/sla-policies (project-level).
 */
export const slaPoliciesTable = pgTable("sla_policies", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  /**
   * When set, this policy overrides the org-level default for the given project.
   * Null means this row is an org-level default.
   */
  projectId: integer("project_id")
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  /** Task priority this policy applies to: low | medium | high | critical */
  priority: varchar("priority", { length: 16 }).notNull(),
  /** Maximum minutes before a first response is required. Null = no target. */
  responseMinutes: integer("response_minutes"),
  /** Maximum minutes before the task must be resolved. Null = no target. */
  resolutionMinutes: integer("resolution_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SlaPolicy = typeof slaPoliciesTable.$inferSelect;
export type InsertSlaPolicy = typeof slaPoliciesTable.$inferInsert;
