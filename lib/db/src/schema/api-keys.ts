import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { usersTable } from './auth';
import { organizationsTable } from './organizations';

export const API_KEY_SCOPES = [
  'tasks:read',
  'tasks:write',
  'projects:read',
  'projects:write',
  'comments:read',
  'comments:write',
  'webhooks:read',
  'webhooks:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeysTable = pgTable(
  'api_keys',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: varchar('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    /** First 8 characters of the generated key (for display / identification). */
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    /** SHA-256 hex digest of the full key value. */
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    /** Array of scope strings the key grants access to. */
    scopes: text('scopes').array().notNull().default(sql`ARRAY[]::text[]`),
    /** Optional expiry; null means the key never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** The user who created this key. */
    createdBy: varchar('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the key is revoked; null means the key is still active. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Unique index on key_hash so duplicate hashes are rejected at the DB level and
    // the authMiddleware hash lookup is always an O(1) index scan — never a table scan.
    uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
  ],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = typeof apiKeysTable.$inferInsert;
