import { type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, orgMembersTable, organizationsTable, rolesTable } from '@workspace/db';
import type { PermissionKey, RolePermissions } from '@workspace/db';

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      /** @deprecated Computed for backward-compat: 'admin' when manage_org_settings=true. Prefer orgPermissions. */
      orgRole?: 'admin' | 'member';
      orgRoleId?: string;
      orgRoleName?: string;
      orgPermissions?: RolePermissions;
      isOrgOwner?: boolean;
    }
  }
}

/**
 * Require the request to come from an authenticated user who belongs to an org.
 * Attaches req.orgId, req.orgRole, req.orgRoleId, req.orgPermissions, req.isOrgOwner on success.
 * Returns 401 if not authenticated, 403 if not an org member.
 */
export async function requireOrg(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [membership] = await db
    .select({
      orgId: orgMembersTable.orgId,
      roleId: orgMembersTable.roleId,
      roleName: rolesTable.name,
      isOwner: rolesTable.isOwner,
      permissions: rolesTable.permissions,
    })
    .from(orgMembersTable)
    .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
    .innerJoin(
      organizationsTable,
      eq(orgMembersTable.orgId, organizationsTable.id),
    )
    .where(eq(orgMembersTable.userId, req.user.id))
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: 'No organization membership' });
    return;
  }

  req.orgId = membership.orgId;
  req.orgRoleId = membership.roleId;
  req.orgRoleName = membership.roleName;
  req.isOrgOwner = membership.isOwner;
  req.orgPermissions = membership.permissions;
  // Backward-compat: treat as 'admin' when the user can manage org settings
  req.orgRole = membership.permissions?.manage_org_settings ? 'admin' : 'member';
  next();
}

/**
 * Require the requesting user to have manage_org_settings permission.
 * Must be used after requireOrg.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.orgPermissions?.manage_org_settings) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Require the requesting user to have Owner role (immutable highest privilege).
 * Must be used after requireOrg.
 */
export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isOrgOwner) {
    res.status(403).json({ error: 'Owner access required' });
    return;
  }
  next();
}

/**
 * Require the requesting user to have a specific permission.
 * Returns a middleware function. Must be used after requireOrg.
 *
 * @example router.post('/foo', requireOrg, requirePermission('create_tasks'), handler)
 */
export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  };
}

/**
 * Require the request to come from an authenticated user (no org check).
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
