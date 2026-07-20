/**
 * Role management routes.
 *
 *   GET    /roles               – list all roles for the current org
 *   POST   /roles               – create a custom role (owner only)
 *   PATCH  /roles/:id           – update a role's name/permissions (owner only; all built-in roles are read-only)
 *   DELETE /roles/:id           – delete a custom role (owner only; built-in cannot be deleted)
 *
 * Built-in role policy
 * --------------------
 * Owner, Admin, and Member are seeded for every org and are read-only at
 * both the API and UI layers. Neither their names nor their permissions may
 * be changed. To apply different permissions, create a custom role instead.
 */

import { Router, type IRouter } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  rolesTable,
  orgMembersTable,
  ALL_PERMISSIONS,
  MEMBER_PERMISSIONS,
} from '@workspace/db';
import type { RolePermissions } from '@workspace/db';
import { requireOrg, requireOwner } from '../middlewares/requireOrgMiddleware';

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeRole(r: typeof rolesTable.$inferSelect) {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    isBuiltIn: r.isBuiltIn,
    isOwner: r.isOwner,
    permissions: r.permissions,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

const permissionsSchema = z
  .object(
    Object.fromEntries(ALL_PERMISSIONS.map((k) => [k, z.boolean()])) as Record<
      (typeof ALL_PERMISSIONS)[number],
      z.ZodBoolean
    >,
  )
  .partial();

// ─── GET /roles ──────────────────────────────────────────────────────────────

router.get('/roles', requireOrg, async (req, res): Promise<void> => {
  const roles = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.orgId, req.orgId!))
    .orderBy(rolesTable.createdAt);

  // Sort: built-in first (Owner, Admin, Member), then custom alphabetically
  const builtInOrder: Record<string, number> = { Owner: 0, Admin: 1, Member: 2 };
  roles.sort((a, b) => {
    if (a.isBuiltIn && b.isBuiltIn) {
      return (builtInOrder[a.name] ?? 99) - (builtInOrder[b.name] ?? 99);
    }
    if (a.isBuiltIn) return -1;
    if (b.isBuiltIn) return 1;
    return a.name.localeCompare(b.name);
  });

  res.json(roles.map(serializeRole));
});

// ─── POST /roles ─────────────────────────────────────────────────────────────

router.post('/roles', requireOrg, requireOwner, async (req, res): Promise<void> => {
  const schema = z.object({
    name: z.string().min(1).max(100),
    permissions: permissionsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Name must be unique within the org
  const [existing] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(and(eq(rolesTable.orgId, req.orgId!), eq(rolesTable.name, parsed.data.name)))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'A role with that name already exists' });
    return;
  }

  // Merge provided permissions over Member defaults
  const permissions: RolePermissions = {
    ...MEMBER_PERMISSIONS,
    ...(parsed.data.permissions ?? {}),
  };

  const [role] = await db
    .insert(rolesTable)
    .values({
      orgId: req.orgId!,
      name: parsed.data.name,
      isBuiltIn: false,
      isOwner: false,
      permissions,
    })
    .returning();

  res.status(201).json(serializeRole(role));
});

// ─── PATCH /roles/:id ────────────────────────────────────────────────────────

router.patch('/roles/:id', requireOrg, requireOwner, async (req, res): Promise<void> => {
  const roleId = String(req.params['id']);
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    permissions: permissionsSchema.optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [role] = await db
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.id, roleId), eq(rolesTable.orgId, req.orgId!)))
    .limit(1);

  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  // All built-in roles (Owner, Admin, Member) are read-only.
  // Guide the caller toward creating a custom role instead.
  if (role.isBuiltIn) {
    res.status(403).json({
      error: `The ${role.name} role is a built-in role and cannot be modified.`,
      hint: 'Create a custom role to define a different permission set for your organization.',
    });
    return;
  }

  // Check name uniqueness if renaming
  if (parsed.data.name && parsed.data.name !== role.name) {
    const [conflict] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(
        and(
          eq(rolesTable.orgId, req.orgId!),
          eq(rolesTable.name, parsed.data.name),
        ),
      )
      .limit(1);
    if (conflict) {
      res.status(409).json({ error: 'A role with that name already exists' });
      return;
    }
  }

  const updatedPermissions: RolePermissions = parsed.data.permissions
    ? { ...role.permissions, ...parsed.data.permissions }
    : role.permissions;

  const updates: Partial<typeof rolesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.permissions !== undefined) updates.permissions = updatedPermissions;

  const [updated] = await db
    .update(rolesTable)
    .set(updates)
    .where(and(eq(rolesTable.id, roleId), eq(rolesTable.orgId, req.orgId!)))
    .returning();

  res.json(serializeRole(updated));
});

// ─── DELETE /roles/:id ───────────────────────────────────────────────────────

router.delete('/roles/:id', requireOrg, requireOwner, async (req, res): Promise<void> => {
  const roleId = String(req.params['id']);
  const [role] = await db
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.id, roleId), eq(rolesTable.orgId, req.orgId!)))
    .limit(1);

  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  // Built-in roles (Owner, Admin, Member) are read-only and cannot be deleted.
  if (role.isBuiltIn) {
    res.status(403).json({
      error: `The ${role.name} role is a built-in role and cannot be deleted.`,
      hint: 'Create a custom role to define a different permission set for your organization.',
    });
    return;
  }

  // Find the Member built-in role to reassign members
  const [memberRole] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(
      and(
        eq(rolesTable.orgId, req.orgId!),
        eq(rolesTable.isBuiltIn, true),
        sql`${rolesTable.name} = 'Member'`,
      ),
    )
    .limit(1);

  if (!memberRole) {
    res.status(500).json({ error: 'Member built-in role not found — cannot reassign members' });
    return;
  }

  // Reassign all members using this role to Member
  await db
    .update(orgMembersTable)
    .set({ roleId: memberRole.id })
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.roleId, role.id),
      ),
    );

  await db
    .delete(rolesTable)
    .where(and(eq(rolesTable.id, role.id), eq(rolesTable.orgId, req.orgId!)));

  res.status(204).send();
});

export default router;
