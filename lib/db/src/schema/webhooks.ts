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
import { taskTemplatesTable } from "./task-templates";

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
  | "task.sla_breached"
  | "task.sla_warning"
  | "task.deleted"
  | "task.watcher_added"
  | "task.watcher_removed"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "member.joined"
  | "member.removed"
  | "note.created"
  | "note.updated"
  | "note.deleted";

export const ALL_OUTBOUND_EVENTS: OutboundWebhookEvent[] = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "task.sla_breached",
  "task.sla_warning",
  "task.deleted",
  "task.watcher_added",
  "task.watcher_removed",
  "project.created",
  "project.updated",
  "project.deleted",
  "member.joined",
  "member.removed",
  "note.created",
  "note.updated",
  "note.deleted",
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
  /** Null when created by an API key (no associated user). */
  createdBy: varchar("created_by"),
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
  /**
   * Maximum tasks this webhook may create per rolling 60-second window.
   * Requests that would exceed this return 429 Too Many Requests.
   * Default: 60 (1/second average). Set to a higher value for trusted
   * high-volume senders, or lower it to protect against misbehaving sources.
   */
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  /**
   * Optional reference to the task template used to seed the TemplateBuilder
   * defaults at edit time. SET NULL on template deletion so the baked-in
   * taskTemplate values survive even when the source template is removed.
   */
  taskTemplateId: integer("task_template_id").references(
    () => taskTemplatesTable.id,
    { onDelete: "set null" },
  ),
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
  /** Null when created by an API key (no associated user). */
  createdBy: varchar("created_by"),
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

// ---------------------------------------------------------------------------
// Outbound webhook delivery log
// ---------------------------------------------------------------------------

export const outboundWebhookDeliveriesTable = pgTable(
  "outbound_webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    webhookId: integer("webhook_id")
      .references(() => outboundWebhooksTable.id, { onDelete: "cascade" })
      .notNull(),
    event: text("event").notNull(),
    url: text("url").notNull(),
    /** HTTP status code returned by the external server, null on network error. */
    statusCode: integer("status_code"),
    success: boolean("success").notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** Network-level error message when the request could not be sent. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type OutboundWebhookDelivery =
  typeof outboundWebhookDeliveriesTable.$inferSelect;
