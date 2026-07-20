import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, usersTable } from '@workspace/db';

declare global {
  namespace Express {
    interface Request {
      /** Set when the request is authenticated as an instance admin. */
      instanceAdminActor?: string;
    }
  }
}

/**
 * Middleware that grants access only to instance administrators.
 *
 * Two paths:
 *  1. Bearer token: `Authorization: Bearer <INSTANCE_ADMIN_TOKEN>` — the
 *     token is compared to the INSTANCE_ADMIN_TOKEN env var. No user session
 *     is required. This is the path for CLI/programmatic access.
 *  2. Session user: if the session user has `isInstanceAdmin = true` in the
 *     database, they are granted access. The DB is queried on every call so
 *     the flag is always fresh (no session-staleness risk).
 *
 * Returns 401 if not authenticated at all, 403 if authenticated but not admin.
 */
export async function requireInstanceAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const instanceAdminToken = process.env.INSTANCE_ADMIN_TOKEN;

  // ── Path 1: Bearer token ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && instanceAdminToken) {
    const provided = authHeader.slice('Bearer '.length);
    // Constant-time comparison to prevent timing attacks.
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(instanceAdminToken);
    if (
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      // Use first 8 chars of the sha256 hash as a safe, loggable actor id.
      req.instanceAdminActor =
        'token:' + crypto.createHash('sha256').update(provided).digest('hex').slice(0, 8);
      next();
      return;
    }
    // If a Bearer token was provided but didn't match, fail immediately.
    // (Prevents falling through to session auth when a bad token is given.)
    res.status(403).json({ error: 'Invalid instance admin token' });
    return;
  }

  // ── Path 2: Session user ──────────────────────────────────────────────────
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [userRow] = await db
    .select({ isInstanceAdmin: usersTable.isInstanceAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!userRow?.isInstanceAdmin) {
    res.status(403).json({ error: 'Instance admin access required' });
    return;
  }

  req.instanceAdminActor = 'user:' + (req.user.email ?? req.user.id);
  next();
}
