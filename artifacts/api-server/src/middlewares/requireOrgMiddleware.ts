import { type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, orgMembersTable, organizationsTable, rolesTable } from '@workspace/db';
import type { ApiKeyScope, PermissionKey, RolePermissions } from '@workspace/db';

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      orgRoleId?: string;
      orgRoleName?: string;
      orgPermissions?: RolePermissions;
      isOrgOwner?: boolean;
    }
  }
}

/**
 * Require the request to come from an authenticated user who belongs to an org,
 * OR from a valid API key (which already has orgId attached by authMiddleware).
 *
 * Session path:  attaches req.orgId, req.orgRoleId, req.orgRoleName, req.orgPermissions, req.isOrgOwner
 * API key path:  req.orgId is already set; orgPermissions is left undefined (use requireScope instead)
 *
 * Returns 401 if not authenticated, 403 if not an org member.
 *
 * Use this only on routes that explicitly declare requireScope() for API-key access.
 * All other routes should use requireOrg(), which is fail-closed for API keys.
 */
export async function requireOrgOrApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // API key path — orgId was set by authMiddleware; skip membership lookup.
  if (req.apiKeyId) {
    next();
    return;
  }

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
  next();
}

/**
 * Fail-closed variant of requireOrgOrApiKey: rejects API key requests outright.
 *
 * Use this on all routes that should NOT be accessible by API keys.
 * This is the default for every route that does not declare requireScope().
 */
export async function requireOrg(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.apiKeyId) {
    res.status(403).json({ error: 'This endpoint requires session authentication; API keys cannot perform this action.' });
    return;
  }
  return requireOrgOrApiKey(req, res, next);
}

/** Shared rejection for API keys hitting session-only endpoints. */
function rejectApiKey(res: Response): void {
  res.status(403).json({ error: 'This endpoint requires session authentication; API keys cannot perform this action.' });
}

/**
 * Require the requesting user to have admin-level access (manage_projects).
 * Both the Admin and Owner built-in roles have this permission; Member does not.
 * Must be used after requireOrg.
 *
 * Explicitly rejects API key requests — use requireScope for API-key-accessible routes.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.apiKeyId) { rejectApiKey(res); return; }
  if (!req.orgPermissions?.manage_projects) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Require the requesting user to have Owner role (immutable highest privilege).
 * Must be used after requireOrg.
 *
 * Explicitly rejects API key requests.
 */
export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.apiKeyId) { rejectApiKey(res); return; }
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
 * Explicitly rejects API key requests — routes accessible by API keys must use
 * requireScope() instead of (or in addition to) requirePermission().
 *
 * @example router.post('/foo', requireOrg, requirePermission('create_tasks'), handler)
 */
export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Fail-closed: API keys may not pass RBAC guards. Only routes that explicitly
    // declare requireScope() are accessible by API keys.
    if (req.apiKeyId) { rejectApiKey(res); return; }
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  };
}

/**
 * Require the API key to have a specific scope.
 * For session-authenticated requests this is a no-op (sessions have full access
 * to whatever their role permissions allow).
 *
 * Must be used after requireOrg.
 *
 * @example router.get('/tasks', requireOrg, requireScope('tasks:read'), handler)
 */
export function requireScope(scope: ApiKeyScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Session auth — scope check doesn't apply.
    if (!req.apiKeyId) {
      next();
      return;
    }
    if (!req.apiKeyScopes?.includes(scope)) {
      res.status(403).json({ error: 'insufficient_scope', required: scope });
      return;
    }
    next();
  };
}

/**
 * Check whether the request has a given RBAC permission.
 *
 * For API key requests this always returns true — scope enforcement via
 * `requireScope` already gates access, so inline RBAC checks are bypassed.
 * For session requests, the org role's permission map is consulted.
 *
 * Must be used after requireOrg.
 */
export function hasPermission(req: Request, key: PermissionKey): boolean {
  if (req.apiKeyId) return true;
  return req.orgPermissions?.[key] ?? false;
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
