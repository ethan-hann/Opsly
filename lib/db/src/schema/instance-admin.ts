import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { organizationsTable } from './organizations';

// ─── Feature names ───────────────────────────────────────────────────────────

export const ORG_FEATURES = [
  'webhooks',
  'api_keys',
  'data_export',
  'custom_fields',
  'custom_statuses',
  'sla_tracking',
] as const;

export type OrgFeature = (typeof ORG_FEATURES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

/**
 * Per-org feature flags. If no row exists for a given org+feature, the feature
 * is considered enabled by default (opt-out model so existing orgs are unaffected).
 */
export const orgFeaturesTable = pgTable(
  'org_features',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    orgId: text('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull().$type<OrgFeature>(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('org_features_org_id_feature_uniq').on(table.orgId, table.feature)],
);

/**
 * Audit log for all instance-admin actions (separate from the per-org task audit log).
 */
export const instanceAuditLogTable = pgTable('instance_audit_log', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  /** Short identifier for the actor: email of the session user, or first 8 chars of the token. */
  actor: text('actor').notNull(),
  /** Machine-readable action name, e.g. "disable_org", "toggle_feature". */
  action: text('action').notNull(),
  /** Type of the primary target: "org" | "user" | "feature" | "member". */
  targetType: text('target_type').notNull(),
  /** ID of the primary target (orgId, userId, etc.). */
  targetId: text('target_id').notNull(),
  /** Any extra context (feature name, old/new values, etc.) */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OrgFeatureRow = typeof orgFeaturesTable.$inferSelect;
export type InsertOrgFeatureRow = typeof orgFeaturesTable.$inferInsert;
export type InstanceAuditLog = typeof instanceAuditLogTable.$inferSelect;
export type InsertInstanceAuditLog = typeof instanceAuditLogTable.$inferInsert;
