import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  varchar,
  integer,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./auth";

/**
 * Supported notification event types.
 *
 * - task_assigned        — the current user was assigned (or re-assigned) to a task
 * - task_updated         — a task the user is watching had its status, priority, or assignee changed
 * - comment_added        — a new comment was posted on a task the user is watching or assigned to
 * - sla_breached         — a task the user is watching or is assigned to breached its SLA
 * - mention              — the user was @mentioned in a comment (future)
 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "task_assigned",
  "task_updated",
  "comment_added",
  "sla_breached",
  "mention",
  "export_ready",
]);

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

/**
 * In-app notifications for each user.
 * Scoped to org + user. Pruned automatically after 30 days.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** Who triggered the event (null for system events like SLA). */
  actorId: varchar("actor_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  /** Human-readable display name of the actor at the time of the event. */
  actorName: text("actor_name"),
  type: notificationTypeEnum("type").notNull(),
  /** "task" | "comment" | "project" */
  entityType: text("entity_type").notNull(),
  /** ID of the referenced entity (task ID, comment ID, etc.) */
  entityId: integer("entity_id").notNull(),
  /** Short human-readable description, e.g. "assigned you to Fix the login bug" */
  message: text("message").notNull(),
  /** False until the user opens the notification dropdown. */
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;

/**
 * Per-user, per-org toggle for each notification type.
 * A missing row means enabled (opt-out model).
 */
export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    eventType: notificationTypeEnum("event_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("notification_preferences_user_org_type_idx").on(
      table.userId,
      table.orgId,
      table.eventType,
    ),
  ],
);

export type NotificationPreference =
  typeof notificationPreferencesTable.$inferSelect;
