import crypto from 'crypto';
import type { AuthUser } from '@workspace/api-zod';
import { type NextFunction, type Request, type Response } from 'express';
import * as oidc from 'openid-client';
import { and, eq, isNull } from 'drizzle-orm';
import { db, apiKeysTable } from '@workspace/db';
import type { ApiKeyScope } from '@workspace/db';

import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from '../lib/auth';

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
      /** Set when the request is authenticated via an API key. */
      apiKeyId?: string;
      /** Scopes granted by the API key. */
      apiKeyScopes?: ApiKeyScope[];
      /** The API key's display name (used in audit trail). */
      apiKeyName?: string;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(config, session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

/** Attempt to resolve an API key from the Authorization header. */
async function resolveApiKey(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer opsly_')) return false;

  const rawKey = authHeader.slice('Bearer '.length);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const now = new Date();
  const [keyRow] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, keyHash), isNull(apiKeysTable.revokedAt)))
    .limit(1);

  if (!keyRow) return false;

  // Reject expired keys
  if (keyRow.expiresAt && keyRow.expiresAt < now) return false;

  req.apiKeyId = keyRow.id;
  req.apiKeyScopes = keyRow.scopes as ApiKeyScope[];
  req.apiKeyName = keyRow.name;
  // Attach orgId directly on the request so requireOrg can pick it up.
  req.orgId = keyRow.orgId;

  return true;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request['isAuthenticated'];

  // Try API key auth first (opsly_ Bearer token).
  const resolvedViaApiKey = await resolveApiKey(req);
  if (resolvedViaApiKey) {
    next();
    return;
  }

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}
