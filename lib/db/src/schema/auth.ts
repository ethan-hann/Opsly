import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// Session storage for all auth modes (OIDC + local credentials).
export const sessionsTable = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)],
);

export const usersTable = pgTable(
  'users',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar('email').unique(),
    firstName: varchar('first_name'),
    lastName: varchar('last_name'),
    profileImageUrl: varchar('profile_image_url'),
    /** 'oidc' for external providers, 'local' for DB credentials. */
    authProvider: varchar('auth_provider', { length: 32 })
      .notNull()
      .default('oidc'),
    /** External subject identifier when authProvider is 'oidc'. */
    externalAuthId: varchar('external_auth_id'),
    /** Scrypt hash for local accounts. */
    passwordHash: varchar('password_hash'),
    /** When true, this user has instance-admin privileges across all orgs. */
    isInstanceAdmin: boolean('is_instance_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('users_auth_provider_external_auth_id_idx').on(
      table.authProvider,
      table.externalAuthId,
    ),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

export const passwordResetsTable = pgTable('password_resets', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  token: varchar('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type InsertPasswordReset = typeof passwordResetsTable.$inferInsert;
export type PasswordReset = typeof passwordResetsTable.$inferSelect;
