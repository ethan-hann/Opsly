import { pgTable, text, serial, timestamp, integer, varchar, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

/**
 * Immutable audit log of project-level SLA policy replacements.
 * One row is inserted each time PUT /projects/:id/sla-policies is called,
 * capturing who made the change, when, and what the previous and new policies were.
 */
export const projectSlaPolicyAuditTable = pgTable("project_sla_policy_audit", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  /** ID of the user or API key that triggered the change. */
  actorId: text("actor_id"),
  /** Display name of the actor at the time of the change. */
  actorName: text("actor_name"),
  /** JSON snapshot of the project-level SLA policies before this PUT. */
  previousPolicies: jsonb("previous_policies").notNull(),
  /** JSON snapshot of the project-level SLA policies after this PUT. */
  newPolicies: jsonb("new_policies").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectSlaPolicyAudit = typeof projectSlaPolicyAuditTable.$inferSelect;
