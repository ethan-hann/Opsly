import crypto from 'crypto';
import type { AuthUser } from '@workspace/api-zod';
import { db, sessionsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { type Request, type Response } from 'express';
import * as client from 'openid-client';

export type AuthMode = 'replit_oidc' | 'oidc' | 'local';

interface OidcAuthConfig {
  mode: 'replit_oidc' | 'oidc';
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
}

interface LocalAuthConfig {
  mode: 'local';
}

export type AuthConfig = OidcAuthConfig | LocalAuthConfig;

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  authProvider?: 'oidc' | 'local';
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;
let cachedAuthConfig: AuthConfig | null = null;

function parseAuthMode(raw: string | undefined): AuthMode {
  if (!raw || raw === 'replit_oidc') return 'replit_oidc';
  if (raw === 'oidc' || raw === 'local') return raw;
  throw new Error(
    `Invalid AUTH_MODE "${raw}". Expected one of: replit_oidc, oidc, local.`,
  );
}

export function getAuthConfig(): AuthConfig {
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  const mode = parseAuthMode(process.env.AUTH_MODE?.trim().toLowerCase());

  if (mode === 'local') {
    cachedAuthConfig = { mode };
    return cachedAuthConfig;
  }

  if (mode === 'replit_oidc') {
    cachedAuthConfig = {
      mode,
      issuerUrl: process.env.ISSUER_URL ?? 'https://replit.com/oidc',
      clientId: process.env.REPL_ID ?? '',
    };
    return cachedAuthConfig;
  }

  cachedAuthConfig = {
    mode,
    issuerUrl: process.env.OIDC_ISSUER_URL ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET,
  };
  return cachedAuthConfig;
}

export function isOidcAuthMode(mode: AuthMode): mode is 'replit_oidc' | 'oidc' {
  return mode === 'replit_oidc' || mode === 'oidc';
}

export function getAuthMode(): AuthMode {
  return getAuthConfig().mode;
}

export function getOidcAuthConfig(): OidcAuthConfig {
  const config = getAuthConfig();
  if (!isOidcAuthMode(config.mode)) {
    throw new Error('OIDC config requested while AUTH_MODE is local');
  }
  if (!config.issuerUrl || !config.clientId) {
    if (config.mode === 'replit_oidc') {
      throw new Error(
        'REPL_ID (and optional ISSUER_URL) must be set when AUTH_MODE is replit_oidc',
      );
    }
    throw new Error(
      'OIDC_ISSUER_URL and OIDC_CLIENT_ID must be set when AUTH_MODE is oidc',
    );
  }
  return config;
}

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    const authConfig = getOidcAuthConfig();
    oidcConfig = await client.discovery(
      new URL(authConfig.issuerUrl),
      authConfig.clientId,
      authConfig.clientSecret
        ? { client_secret: authConfig.clientSecret }
        : undefined,
    );
  }
  return oidcConfig;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString('hex');
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
