import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  varchar,
  pgEnum,
  primaryKey,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';
// NOTE: org_role enum was dropped from the database in the add-roles-and-permissions
// migration. It no longer exists in the schema; the column was replaced by role_id FK.
import { usersTable } from './auth';

// ─── Permission keys ──────────────────────────────────────────────────────────

export const ALL_PERMISSIONS = [
  'view_tasks',
  'create_tasks',
  'edit_tasks',
  'close_tasks',
  'delete_tasks',
  'manage_projects',
  'manage_org_settings',
  'manage_members',
  'manage_webhooks',
  'manage_api_keys',
  'manage_custom_fields',
  'manage_workflow_stages',
  'manage_sla_policies',
  'manage_task_templates',
  'manage_saved_views',
  'view_audit_log',
  'manage_terminology',
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];
export type RolePermissions = Record<PermissionKey, boolean>;

export const OWNER_PERMISSIONS: RolePermissions = {
  view_tasks: true,
  create_tasks: true,
  edit_tasks: true,
  close_tasks: true,
  delete_tasks: true,
  manage_projects: true,
  manage_org_settings: true,
  manage_members: true,
  manage_webhooks: true,
  manage_api_keys: true,
  manage_custom_fields: true,
  manage_workflow_stages: true,
  manage_sla_policies: true,
  manage_task_templates: true,
  manage_saved_views: true,
  view_audit_log: true,
  manage_terminology: true,
};

/**
 * Admin role permissions — operational management without org-security controls.
 * Deliberately excluded (Owner-only):
 *   - manage_org_settings  (rename/delete org — structural, irreversible)
 *   - manage_members        (invite, remove, role assignments — privilege escalation risk)
 *   - manage_api_keys       (org-wide credentials — security boundary)
 */
export const ADMIN_PERMISSIONS: RolePermissions = {
  view_tasks: true,
  create_tasks: true,
  edit_tasks: true,
  close_tasks: true,
  delete_tasks: true,
  manage_projects: true,
  manage_org_settings: false,  // Owner-only
  manage_members: false,        // Owner-only
  manage_webhooks: true,
  manage_api_keys: false,       // Owner-only
  manage_custom_fields: true,
  manage_workflow_stages: true,
  manage_sla_policies: true,
  manage_task_templates: true,
  manage_saved_views: true,
  view_audit_log: true,
  manage_terminology: true,
};

export const MEMBER_PERMISSIONS: RolePermissions = {
  view_tasks: true,
  create_tasks: true,
  edit_tasks: true,
  close_tasks: true,
  delete_tasks: false,
  manage_projects: false,
  manage_org_settings: false,
  manage_members: false,
  manage_webhooks: false,
  manage_api_keys: false,
  manage_custom_fields: false,
  manage_workflow_stages: false,
  manage_sla_policies: false,
  manage_task_templates: false,
  manage_saved_views: false,
  view_audit_log: false,
  manage_terminology: false,
};

// ─── Enums ────────────────────────────────────────────────────────────────────

export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'declined',
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const organizationsTable = pgTable('organizations', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  /** When true, all members of this org will see a "suspended" screen. */
  isDisabled: boolean('is_disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-org role definitions. Three built-in roles are seeded for every new org:
 *   Owner  (isOwner=true,  immutable permissions, all true)
 *   Admin  (isBuiltIn,     configurable, all true by default)
 *   Member (isBuiltIn,     configurable, basic access by default)
 * Owners can additionally create custom roles.
 */
export const rolesTable = pgTable('roles', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar('org_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Built-in roles (Owner, Admin, Member) cannot be deleted. */
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  /** Owner role is immutable — its permissions cannot be changed. */
  isOwner: boolean('is_owner').notNull().default(false),
  permissions: jsonb('permissions').notNull().$type<RolePermissions>(),
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
    /** FK to roles.id — NOT NULL. Delete restricted: reassign members before deleting a role. */
    roleId: text('role_id')
      .notNull()
      .references(() => rolesTable.id, { onDelete: 'restrict' }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);

export const invitationsTable = pgTable('invitations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
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
export type Role = typeof rolesTable.$inferSelect;
export type InsertRole = typeof rolesTable.$inferInsert;
export type OrgMember = typeof orgMembersTable.$inferSelect;
export type InsertOrgMember = typeof orgMembersTable.$inferInsert;
export type Invitation = typeof invitationsTable.$inferSelect;
export type InsertInvitation = typeof invitationsTable.$inferInsert;
