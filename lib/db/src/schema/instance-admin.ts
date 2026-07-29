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

/**
 * Gateable per-org features.
 *
 * NOTE: data export is deliberately absent and must stay that way — users can
 * always extract their own data, regardless of plan or instance configuration.
 */
export const ORG_FEATURES = [
  'webhooks',
  'api_keys',
  'custom_fields',
  'custom_statuses',
  'sla_tracking',
  'branding',
  'task_trees',
] as const;

export type OrgFeature = (typeof ORG_FEATURES)[number];

// ─── Tables ──────────────────────────────────────────────────────────────────

/**
 * Per-org feature flags. If no row exists for a given org+feature, the feature
 * is considered enabled by default (opt-out model so existing orgs are unaffected).
 */
export type OrgFeatureState = 'enabled' | 'disabled' | 'unsubscribed';

export const orgFeaturesTable = pgTable(
  'org_features',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    orgId: text('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull().$type<OrgFeature>(),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Three-state feature flag:
     *   'enabled'      — available to the org (default)
     *   'disabled'     — turned off by an instance admin (hard-off)
     *   'unsubscribed' — not included in the org's plan (upgrade prompt)
     *
     * Kept in sync with the legacy `enabled` boolean:
     *   'enabled' ↔ enabled=true, 'disabled'/'unsubscribed' ↔ enabled=false.
     */
    featureState: text('feature_state')
      .notNull()
      .default('enabled')
      .$type<OrgFeatureState>(),
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

// ─── Instance SMTP config ─────────────────────────────────────────────────────

/**
 * Single-row table (keyed by id = 'default') that holds a live SMTP config
 * override. When a row is present, the API server uses it in preference to
 * environment variables. The password is stored AES-256-GCM encrypted via
 * the encryption utility in artifacts/api-server/src/lib/encryption.ts.
 *
 * A server restart clears the in-memory override but the DB row persists,
 * so loadSmtpOverride() re-applies it on next startup.
 */
export const instanceSmtpConfigTable = pgTable('instance_smtp_config', {
  /** Always 'default' — single-row table. */
  id: text('id').primaryKey().default('default'),
  host: text('host').notNull(),
  port: text('port').notNull(),
  secure: boolean('secure').notNull().default(false),
  user: text('user').notNull().default(''),
  /** AES-256-GCM ciphertext from encrypt(). Null if no password is set. */
  passEncrypted: text('pass_encrypted'),
  fromAddress: text('from_address').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type InstanceSmtpConfig = typeof instanceSmtpConfigTable.$inferSelect;
export type InsertInstanceSmtpConfig = typeof instanceSmtpConfigTable.$inferInsert;
