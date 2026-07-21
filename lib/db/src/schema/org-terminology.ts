import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizationsTable } from './organizations';

// ─── Term keys & defaults ─────────────────────────────────────────────────────

export const TERMINOLOGY_KEYS = [
  'projects',
  'tasks',
  'members',
  'workflows',
  'stages',
] as const;

export type TerminologyKey = (typeof TERMINOLOGY_KEYS)[number];

/** Keys used to store admin-set singular overrides alongside the plural keys. */
export const SINGULAR_TERMINOLOGY_KEYS = [
  'projectsSingular',
  'tasksSingular',
  'membersSingular',
  'workflowsSingular',
  'stagesSingular',
] as const;

export type SingularTerminologyKey = (typeof SINGULAR_TERMINOLOGY_KEYS)[number];

export const TERMINOLOGY_DEFAULTS: Record<TerminologyKey, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  members: 'Members',
  workflows: 'Workflows',
  stages: 'Stages',
};

// ─── Table ────────────────────────────────────────────────────────────────────

/**
 * Per-org terminology overrides.
 * Each row overrides one term key for one org.
 * Keys not present in this table fall back to TERMINOLOGY_DEFAULTS.
 */
export const orgTerminologyTable = pgTable(
  'org_terminology',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    orgId: varchar('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),

    /** One of the valid TERMINOLOGY_KEYS values. */
    termKey: text('term_key').notNull(),

    /** Org-supplied label for this term, 1–50 characters. */
    customLabel: text('custom_label').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('org_terminology_org_key_idx').on(table.orgId, table.termKey),
  ],
);

export type OrgTerminology = typeof orgTerminologyTable.$inferSelect;
export type InsertOrgTerminology = typeof orgTerminologyTable.$inferInsert;
