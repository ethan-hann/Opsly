import {
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  GetCurrentAuthUserResponse,
  LogoutMobileSessionResponse,
} from '@workspace/api-zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, invitationsTable, usersTable, passwordResetsTable } from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';
import * as oidc from 'openid-client';
import crypto from 'crypto';
import { z } from 'zod';

import {
  clearSession,
  createSession,
  deleteSession,
  getAuthConfig,
  getAuthMode,
  getOidcAuthConfig,
  getOidcConfig,
  getSessionId,
  isOidcAuthMode,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from '../lib/auth';
import { hashLocalPassword, verifyLocalPassword } from '../lib/local-password';
import { buildPasswordResetEmail, sendMail } from '../lib/email';

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const localLoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  returnTo: z.string().optional(),
});

const localInviteRegistrationBodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  returnTo: z.string().optional(),
});

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host =
    req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost';
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_COOKIE_TTL,
  });
}

function clearOidcCookies(res: Response) {
  res.clearCookie('code_verifier', { path: '/' });
  res.clearCookie('nonce', { path: '/' });
  res.clearCookie('state', { path: '/' });
  res.clearCookie('return_to', { path: '/' });
}

function getSafeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return '/';
  }
  return value;
}

function getLocalLoginReturnTo(value: string): string {
  if (value === '/') {
    return '/';
  }
  return `/?returnTo=${encodeURIComponent(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorStatus(
  value: Record<string, unknown>,
): number | string | undefined {
  if (typeof value.status === 'number' || typeof value.status === 'string') {
    return value.status;
  }
  if (
    typeof value.statusCode === 'number' ||
    typeof value.statusCode === 'string'
  ) {
    return value.statusCode;
  }
  return undefined;
}

function getSafeErrorMetadata(error: unknown) {
  if (!isRecord(error)) {
    return { errorName: typeof error };
  }

  const errorStatus = getErrorStatus(error);
  const causeStatus = isRecord(error.cause)
    ? getErrorStatus(error.cause)
    : undefined;

  return {
    errorName: error instanceof Error ? error.name : 'Error',
    errorStatus: errorStatus ?? causeStatus,
  };
}

async function upsertOidcUser(claims: Record<string, unknown>) {
  const externalAuthId = claims.sub;
  if (typeof externalAuthId !== 'string' || externalAuthId.length === 0) {
    throw new Error('OIDC claims are missing a valid sub claim');
  }

  const email =
    typeof claims.email === 'string' && claims.email.length > 0
      ? claims.email.toLowerCase()
      : null;
  const firstName =
    typeof claims.first_name === 'string' ? claims.first_name : null;
  const lastName = typeof claims.last_name === 'string' ? claims.last_name : null;
  const profileImageUrl =
    (typeof claims.profile_image_url === 'string' &&
      claims.profile_image_url.length > 0
      ? claims.profile_image_url
      : null) ??
    (typeof claims.picture === 'string' && claims.picture.length > 0
      ? claims.picture
      : null);

  if (email) {
    const [existingByEmail] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingByEmail) {
      const [updatedByEmail] = await db
        .update(usersTable)
        .set({
          email,
          firstName,
          lastName,
          profileImageUrl,
          authProvider: 'oidc',
          externalAuthId,
          passwordHash: null,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingByEmail.id))
        .returning();
      return updatedByEmail;
    }
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      firstName,
      lastName,
      profileImageUrl,
      authProvider: 'oidc',
      externalAuthId,
      passwordHash: null,
    })
    .onConflictDoUpdate({
      target: [usersTable.authProvider, usersTable.externalAuthId],
      set: {
        email,
        firstName,
        lastName,
        profileImageUrl,
        passwordHash: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return user;
}

router.get('/auth/config', (_req: Request, res: Response) => {
  const config = getAuthConfig();
  res.json({
    mode: config.mode,
    loginMethod: config.mode === 'local' ? 'password' : 'oidc',
  });
});

router.get('/auth/user', (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get('/login', async (req: Request, res: Response) => {
  const authMode = getAuthMode();
  const returnTo = getSafeReturnTo(req.query.returnTo);

  if (!isOidcAuthMode(authMode)) {
    res.redirect(getLocalLoginReturnTo(returnTo));
    return;
  }

  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: 'openid email profile offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login consent',
    state,
    nonce,
  });

  setOidcCookie(res, 'code_verifier', codeVerifier);
  setOidcCookie(res, 'nonce', nonce);
  setOidcCookie(res, 'state', state);
  setOidcCookie(res, 'return_to', returnTo);

  res.redirect(redirectTo.href);
});

router.post('/auth/local/login', async (req: Request, res: Response) => {
  if (getAuthMode() !== 'local') {
    res
      .status(400)
      .json({ error: 'Local login is disabled for the configured auth mode.' });
    return;
  }

  const parsed = localLoginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required parameters' });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const { password, returnTo } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), eq(usersTable.authProvider, 'local')))
    .limit(1);

  if (!user?.passwordHash) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const passwordMatches = await verifyLocalPassword(password, user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    authProvider: 'local',
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({
    user: sessionData.user,
    returnTo: getSafeReturnTo(returnTo),
  });
});

router.post('/auth/local/register-invite', async (req: Request, res: Response) => {
  if (getAuthMode() !== 'local') {
    res
      .status(400)
      .json({ error: 'Local registration is disabled for the configured auth mode.' });
    return;
  }

  const parsed = localInviteRegistrationBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required parameters' });
    return;
  }

  const { token, password, returnTo } = parsed.data;
  const firstName = parsed.data.firstName ?? null;
  const lastName = parsed.data.lastName ?? null;

  const [invitation] = await db
    .select({
      invitedEmail: invitationsTable.invitedEmail,
      status: invitationsTable.status,
      expiresAt: invitationsTable.expiresAt,
    })
    .from(invitationsTable)
    .where(eq(invitationsTable.token, token))
    .limit(1);

  if (
    !invitation ||
    invitation.status !== 'pending' ||
    invitation.expiresAt <= new Date()
  ) {
    res.status(404).json({ error: 'Invitation not found or expired' });
    return;
  }

  if (!invitation.invitedEmail) {
    res.status(400).json({ error: 'This invitation requires an existing account.' });
    return;
  }

  const email = invitation.invitedEmail.toLowerCase();

  const [existingUser] = await db
    .select({
      id: usersTable.id,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existingUser) {
    res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
    return;
  }

  const passwordHash = await hashLocalPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      firstName,
      lastName,
      authProvider: 'local',
      externalAuthId: null,
      passwordHash,
      profileImageUrl: null,
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    });

  if (!user) {
    res.status(409).json({ error: 'An account already exists for this email. Please sign in.' });
    return;
  }

  const sessionData: SessionData = {
    user,
    authProvider: 'local',
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.status(201).json({
    user: sessionData.user,
    returnTo: getSafeReturnTo(returnTo),
  });
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get('/callback', async (req: Request, res: Response) => {
  const authMode = getAuthMode();
  if (!isOidcAuthMode(authMode)) {
    res.status(404).send('OIDC callback is disabled');
    return;
  }

  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect('/api/login');
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    clearOidcCookies(res);
    res.redirect('/api/login');
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);
  clearOidcCookies(res);

  const claims = tokens.claims();
  if (!claims) {
    res.redirect('/api/login');
    return;
  }

  const dbUser = await upsertOidcUser(claims as unknown as Record<string, unknown>);

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
    authProvider: 'oidc',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get('/logout', async (req: Request, res: Response) => {
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const sid = getSessionId(req);
  await clearSession(res, sid);

  const authMode = getAuthMode();
  if (!isOidcAuthMode(authMode)) {
    res.redirect(returnTo);
    return;
  }

  const config = await getOidcConfig();
  const origin = getOrigin(req);
  const postLogoutRedirectUrl = new URL(returnTo, `${origin}/`).href;
  const oidcAuthConfig = getOidcAuthConfig();

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: oidcAuthConfig.clientId,
    post_logout_redirect_uri: postLogoutRedirectUrl,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  '/mobile-auth/token-exchange',
  async (req: Request, res: Response) => {
    if (!isOidcAuthMode(getAuthMode())) {
      res
        .status(400)
        .json({ error: 'OIDC token exchange is disabled for local auth mode' });
      return;
    }

    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required parameters' });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();
      const oidcAuthConfig = getOidcAuthConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('iss', oidcAuthConfig.issuerUrl);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: 'No claims in ID token' });
        return;
      }

      const dbUser = await upsertOidcUser(claims as unknown as Record<string, unknown>);

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
        },
        authProvider: 'oidc',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error(getSafeErrorMetadata(err), 'Mobile token exchange error');
      res.status(500).json({ error: 'Token exchange failed' });
    }
  },
);

router.post('/mobile-auth/logout', async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

const localForgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

const localResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

router.post('/auth/local/forgot-password', async (req: Request, res: Response) => {
  if (getAuthMode() !== 'local') {
    res
      .status(400)
      .json({ error: 'Local auth is disabled for the configured auth mode.' });
    return;
  }

  const parsed = localForgotPasswordBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required parameters' });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.email, email), eq(usersTable.authProvider, 'local')))
    .limit(1);

  // Always generate a token to keep timing indistinguishable for unknown emails.
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  if (user) {
    // Invalidate any previous unconsumed tokens for this user.
    await db
      .delete(passwordResetsTable)
      .where(
        and(
          eq(passwordResetsTable.userId, user.id),
          isNull(passwordResetsTable.consumedAt),
        ),
      );

    await db.insert(passwordResetsTable).values({
      userId: user.id,
      token,
      expiresAt,
    });

    const appUrl = process.env['APP_URL'] ?? '';
    const resetLink = `${appUrl}/reset-password?token=${token}`;
    await sendMail({
      to: user.email!,
      subject: 'Reset your Opsly password',
      html: buildPasswordResetEmail({ resetLink }),
    });
  }

  res.json({
    message: 'If an account exists for this email, a reset link has been sent.',
  });
});

router.post('/auth/local/reset-password', async (req: Request, res: Response) => {
  if (getAuthMode() !== 'local') {
    res
      .status(400)
      .json({ error: 'Local auth is disabled for the configured auth mode.' });
    return;
  }

  const parsed = localResetPasswordBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required parameters' });
    return;
  }

  const { token, password } = parsed.data;

  const [resetRow] = await db
    .select()
    .from(passwordResetsTable)
    .where(eq(passwordResetsTable.token, token))
    .limit(1);

  if (!resetRow || resetRow.consumedAt !== null || resetRow.expiresAt <= new Date()) {
    res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    return;
  }

  const passwordHash = await hashLocalPassword(password);

  await db
    .update(usersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, resetRow.userId));

  await db
    .update(passwordResetsTable)
    .set({ consumedAt: new Date() })
    .where(eq(passwordResetsTable.id, resetRow.id));

  res.json({ message: 'Password updated successfully.' });
});

export default router;
