import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Per-org SLA targets keyed by task priority.
 * One row per (orgId, priority) pair; upserted via PUT /org/sla-policies.
 */
export const slaPoliciesTable = pgTable("sla_policies", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
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
