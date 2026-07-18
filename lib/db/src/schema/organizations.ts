import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  varchar,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { usersTable } from './auth';

export const orgRoleEnum = pgEnum('org_role', ['admin', 'member']);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'declined',
]);

export const organizationsTable = pgTable('organizations', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orgMembersTable = pgTable(
  'org_members',
  {
    orgId: varchar('org_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    userId: varchar('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);

export const invitationsTable = pgTable('invitations', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar('org_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade' }),
  invitedEmail: text('invited_email'),
  invitedUserId: varchar('invited_user_id').references(() => usersTable.id, {
    onDelete: 'set null',
  }),
  invitedById: varchar('invited_by_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  token: varchar('token').notNull().unique(),
  status: invitationStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
export type OrgMember = typeof orgMembersTable.$inferSelect;
export type InsertOrgMember = typeof orgMembersTable.$inferInsert;
export type Invitation = typeof invitationsTable.$inferSelect;
export type InsertInvitation = typeof invitationsTable.$inferInsert;
