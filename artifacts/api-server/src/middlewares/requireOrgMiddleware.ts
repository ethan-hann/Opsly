import { type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, orgMembersTable, organizationsTable } from '@workspace/db';

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      orgRole?: 'admin' | 'member';
    }
  }
}

/**
 * Require the request to come from an authenticated user who belongs to an org.
 * Attaches req.orgId and req.orgRole on success.
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
      role: orgMembersTable.role,
    })
    .from(orgMembersTable)
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
  req.orgRole = membership.role;
  next();
}

/**
 * Require the requesting user to be an org admin.
 * Must be used after requireOrg.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.orgRole !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
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
