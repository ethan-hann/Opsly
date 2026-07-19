import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  varchar,
  boolean,
  json,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { organizationsTable } from "./organizations";

export type WebhookVisibility = "private" | "public_read" | "public_write";

/**
 * Controls how an incoming ingest payload maps to task fields.
 * All fields are optional — absent fields fall back to sensible defaults.
 */
export type WebhookTaskTemplate = {
  /** JSON-path key in the payload used as the task title (e.g. "alertname", "summary"). */
  titleField?: string;
  /** Static title fallback when the payload doesn't contain `titleField`. */
  defaultTitle?: string;
  /** JSON-path key used as the task description. */
  descriptionField?: string;
  /** Default priority when the payload doesn't specify one. */
  defaultPriority?: "low" | "medium" | "high" | "critical";
  /** Default category when the payload doesn't specify one. */
  defaultCategory?:
    | "incident"
    | "change"
    | "maintenance"
    | "deployment"
    | "support"
    | "other";
  /**
   * Free-form field mapping: maps a dot-notation payload path to a task field name.
   * Example: { "labels.severity": "priority", "annotations.runbook": "description" }
   */
  fieldMapping?: Record<string, string>;
};

export type OutboundWebhookEvent =
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.assigned"
  | "task.commented"
  | "project.created"
  | "project.updated";

export const ALL_OUTBOUND_EVENTS: OutboundWebhookEvent[] = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "project.created",
  "project.updated",
];

// ---------------------------------------------------------------------------
// Inbound webhooks
// ---------------------------------------------------------------------------

export const inboundWebhooksTable = pgTable("inbound_webhooks", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" })
    .notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  createdBy: varchar("created_by").notNull(),
  name: text("name").notNull(),
  /** 64-character hex token embedded in the ingest URL. */
  token: varchar("token", { length: 64 }).notNull().unique(),
  taskTemplate: json("task_template")
    .$type<WebhookTaskTemplate>()
    .notNull()
    .default({}),
  visibility: varchar("visibility")
    .$type<WebhookVisibility>()
    .notNull()
    .default("private"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertInboundWebhookSchema = createInsertSchema(
  inboundWebhooksTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertInboundWebhook = z.infer<typeof insertInboundWebhookSchema>;
export type InboundWebhook = typeof inboundWebhooksTable.$inferSelect;

// ---------------------------------------------------------------------------
// Outbound webhooks
// ---------------------------------------------------------------------------

export const outboundWebhooksTable = pgTable("outbound_webhooks", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" })
    .notNull(),
  /** Optional project filter — when set, only fire for events on this project. */
  projectId: integer("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  createdBy: varchar("created_by").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** 64-character hex secret used to sign outbound payloads (X-Opsly-Signature). */
  secret: varchar("secret", { length: 64 }).notNull(),
  events: json("events").$type<OutboundWebhookEvent[]>().notNull().default([]),
  visibility: varchar("visibility")
    .$type<WebhookVisibility>()
    .notNull()
    .default("private"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOutboundWebhookSchema = createInsertSchema(
  outboundWebhooksTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertOutboundWebhook = z.infer<typeof insertOutboundWebhookSchema>;
export type OutboundWebhook = typeof outboundWebhooksTable.$inferSelect;
