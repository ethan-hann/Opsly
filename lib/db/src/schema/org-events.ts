import { pgTable, serial, text, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Org-level audit log. One row per org-level mutation (member changes,
 * project lifecycle, webhook changes, role changes, custom field changes,
 * workflow stage changes, and settings changes).
 *
 * Task-level field changes remain in `task_events`.
 */
export const orgEventsTable = pgTable(
  "org_events",
  {
    id: serial("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** ID of the user or API key that triggered the event. Null for system events. */
    actorId: text("actor_id"),
    /** Display name of the actor at the time of the event. */
    actorName: text("actor_name"),
    /**
     * High-level category for filtering.
     * member | project | webhook | role | settings | custom_field | workflow
     */
    category: text("category")
      .notNull()
      .$type<"member" | "project" | "webhook" | "role" | "settings" | "custom_field" | "workflow">(),
    /**
     * Dot-namespaced action string, e.g. "member.invited", "project.deleted".
     */
    action: text("action").notNull(),
    /** ID of the primary affected resource (userId, projectId, webhookId, etc.). */
    targetId: text("target_id"),
    /** Snapshot of the resource name at the time of the event. */
    targetName: text("target_name"),
    /** Extra context (old/new values, counts, etc.) */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("org_events_org_id_created_at_idx").on(t.orgId, t.createdAt),
  ],
);

export type OrgEvent = typeof orgEventsTable.$inferSelect;
export type InsertOrgEvent = typeof orgEventsTable.$inferInsert;
