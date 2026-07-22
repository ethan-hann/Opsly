/**
 * Instance Admin API routes — /api/admin/*
 *
 * All routes are protected by requireInstanceAdmin. They operate across all
 * orgs and are not subject to the normal per-org auth guards.
 */

import { Router, type IRouter } from 'express';
import { eq, sql, and, count, desc } from 'drizzle-orm';
import {
  db,
  organizationsTable,
  orgMembersTable,
  tasksTable,
  usersTable,
  orgFeaturesTable,
  instanceAuditLogTable,
  ORG_FEATURES,
  rolesTable,
} from '@workspace/db';
import type { OrgFeature } from '@workspace/db';
import { requireInstanceAdmin } from '../middlewares/requireInstanceAdmin';
import { sendMail, getEmailConfig, applySmtpOverride, clearSmtpOverride } from '../lib/email';

const router: IRouter = Router();

// Apply instance admin guard to every route in this file.
router.use('/admin', requireInstanceAdmin);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAdminAction(
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(instanceAuditLogTable).values({
    actor,
    action,
    targetType,
    targetId,
    metadata: metadata ?? null,
  });
}

// ─── Admin: "me" ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/me
 * Returns whether the current session user is an instance admin.
 * Used by the frontend to gate access to the admin console.
 */
router.get('/admin/me', async (req, res) => {
  // If we reach here, requireInstanceAdmin already passed.
  res.json({ isInstanceAdmin: true, actor: req.instanceAdminActor });
});

// ─── Orgs ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/orgs
 * List all orgs with member count, task count, and created date.
 */
router.get('/admin/orgs', async (_req, res) => {
  const orgs = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      isDisabled: organizationsTable.isDisabled,
      createdAt: organizationsTable.createdAt,
      memberCount: count(orgMembersTable.userId).as('member_count'),
    })
    .from(organizationsTable)
    .leftJoin(orgMembersTable, eq(orgMembersTable.orgId, organizationsTable.id))
    .groupBy(organizationsTable.id)
    .orderBy(desc(organizationsTable.createdAt));

  // Fetch task counts separately (avoids a double-group-by)
  const taskCounts = await db
    .select({
      orgId: tasksTable.orgId,
      taskCount: count(tasksTable.id).as('task_count'),
    })
    .from(tasksTable)
    .groupBy(tasksTable.orgId);

  const taskCountMap = new Map(taskCounts.map((r) => [r.orgId, Number(r.taskCount)]));

  const result = orgs.map((org) => ({
    ...org,
    memberCount: Number(org.memberCount),
    taskCount: taskCountMap.get(org.id) ?? 0,
  }));

  res.json(result);
});

/**
 * PATCH /api/admin/orgs/:id
 * Enable or disable an org.
 */
router.patch('/admin/orgs/:id', async (req, res) => {
  const { id } = req.params;
  const { isDisabled } = req.body as { isDisabled?: boolean };

  if (typeof isDisabled !== 'boolean') {
    res.status(400).json({ error: 'isDisabled (boolean) is required' });
    return;
  }

  const [updated] = await db
    .update(organizationsTable)
    .set({ isDisabled })
    .where(eq(organizationsTable.id, id))
    .returning({ id: organizationsTable.id, name: organizationsTable.name, isDisabled: organizationsTable.isDisabled });

  if (!updated) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }

  await logAdminAction(
    req.instanceAdminActor!,
    isDisabled ? 'disable_org' : 'enable_org',
    'org',
    id,
    { name: updated.name },
  );

  res.json(updated);
});

/**
 * DELETE /api/admin/orgs/:id
 * Permanently delete an org and all its data (cascade).
 */
router.delete('/admin/orgs/:id', async (req, res) => {
  const { id } = req.params;

  const [org] = await db
    .select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, id))
    .limit(1);

  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, id));

  await logAdminAction(req.instanceAdminActor!, 'delete_org', 'org', id, { name: org.name });

  res.status(204).send();
});

// ─── Feature Flags ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/orgs/:id/features
 * Return all feature flags for an org (missing = enabled by default).
 */
router.get('/admin/orgs/:id/features', async (req, res) => {
  const { id } = req.params;

  const rows = await db
    .select({ feature: orgFeaturesTable.feature, enabled: orgFeaturesTable.enabled })
    .from(orgFeaturesTable)
    .where(eq(orgFeaturesTable.orgId, id));

  const featureMap: Record<string, boolean> = {};
  for (const feat of ORG_FEATURES) {
    featureMap[feat] = true; // default enabled
  }
  for (const row of rows) {
    featureMap[row.feature] = row.enabled;
  }

  res.json(featureMap);
});

/**
 * PATCH /api/admin/orgs/:id/features
 * Toggle one or more feature flags for an org.
 * Body: { feature: OrgFeature, enabled?: boolean, featureState?: 'enabled'|'disabled'|'unsubscribed' }
 *
 * Backward-compatible: if only `enabled` is supplied, derive featureState from it.
 * If `featureState` is supplied, it takes precedence and `enabled` is derived from it.
 */
router.patch('/admin/orgs/:id/features', async (req, res) => {
  const { id } = req.params;
  const { feature, enabled, featureState } = req.body as {
    feature?: string;
    enabled?: boolean;
    featureState?: string;
  };

  if (!feature || !ORG_FEATURES.includes(feature as OrgFeature)) {
    res.status(400).json({ error: `feature must be one of: ${ORG_FEATURES.join(', ')}` });
    return;
  }

  const VALID_STATES = ['enabled', 'disabled', 'unsubscribed'] as const;

  // Resolve the canonical featureState and derived enabled boolean
  let resolvedState: 'enabled' | 'disabled' | 'unsubscribed';
  let resolvedEnabled: boolean;

  if (featureState !== undefined) {
    if (!VALID_STATES.includes(featureState as (typeof VALID_STATES)[number])) {
      res.status(400).json({ error: `featureState must be one of: ${VALID_STATES.join(', ')}` });
      return;
    }
    resolvedState = featureState as 'enabled' | 'disabled' | 'unsubscribed';
    resolvedEnabled = resolvedState === 'enabled';
  } else if (typeof enabled === 'boolean') {
    resolvedState = enabled ? 'enabled' : 'disabled';
    resolvedEnabled = enabled;
  } else {
    res.status(400).json({ error: 'Either enabled (boolean) or featureState (string) is required' });
    return;
  }

  // Check org exists
  const [org] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, id))
    .limit(1);
  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }

  await db
    .insert(orgFeaturesTable)
    .values({
      orgId: id,
      feature: feature as OrgFeature,
      enabled: resolvedEnabled,
      featureState: resolvedState,
    })
    .onConflictDoUpdate({
      target: [orgFeaturesTable.orgId, orgFeaturesTable.feature],
      set: { enabled: resolvedEnabled, featureState: resolvedState, updatedAt: new Date() },
    });

  await logAdminAction(req.instanceAdminActor!, 'toggle_feature', 'feature', id, {
    feature,
    featureState: resolvedState,
    enabled: resolvedEnabled,
  });

  res.json({ orgId: id, feature, enabled: resolvedEnabled, featureState: resolvedState });
});

// ─── Users ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users?search=<email>
 * Global user search. Returns user + their org memberships.
 */
router.get('/admin/users', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const limitNum = Math.min(Number(req.query.limit) || 50, 200);

  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      isInstanceAdmin: usersTable.isInstanceAdmin,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      search
        ? sql`${usersTable.email} ILIKE ${'%' + search + '%'}`
        : undefined,
    )
    .orderBy(desc(usersTable.createdAt))
    .limit(limitNum);

  // Fetch org memberships for all returned users in one query
  const userIds = users.map((u) => u.id);
  let memberships: Array<{ userId: string; orgId: string; orgName: string; roleName: string }> = [];

  if (userIds.length > 0) {
    memberships = await db
      .select({
        userId: orgMembersTable.userId,
        orgId: orgMembersTable.orgId,
        orgName: organizationsTable.name,
        roleName: rolesTable.name,
      })
      .from(orgMembersTable)
      .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
      .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
      .where(sql`${orgMembersTable.userId} = ANY(${sql.raw(`ARRAY[${userIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]`)})`)
  }

  const membershipsByUser = new Map<string, typeof memberships>();
  for (const m of memberships) {
    if (!membershipsByUser.has(m.userId)) membershipsByUser.set(m.userId, []);
    membershipsByUser.get(m.userId)!.push(m);
  }

  const result = users.map((u) => ({
    ...u,
    orgs: (membershipsByUser.get(u.id) ?? []).map((m) => ({
      orgId: m.orgId,
      orgName: m.orgName,
      roleName: m.roleName,
    })),
  }));

  res.json(result);
});

/**
 * DELETE /api/admin/orgs/:orgId/members/:userId
 * Remove a user from an org.
 */
router.delete('/admin/orgs/:orgId/members/:userId', async (req, res) => {
  const { orgId, userId } = req.params;

  const [existing] = await db
    .select({ userId: orgMembersTable.userId })
    .from(orgMembersTable)
    .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, userId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Membership not found' });
    return;
  }

  await db
    .delete(orgMembersTable)
    .where(and(eq(orgMembersTable.orgId, orgId), eq(orgMembersTable.userId, userId)));

  await logAdminAction(req.instanceAdminActor!, 'remove_member', 'member', userId, { orgId });

  res.status(204).send();
});

// ─── Usage ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/usage
 * High-level instance metrics.
 */
router.get('/admin/usage', async (_req, res) => {
  const [[orgsRow], [usersRow], [tasksRow], [recentTasksRow]] = await Promise.all([
    db.select({ total: count() }).from(organizationsTable),
    db.select({ total: count() }).from(usersTable),
    db.select({ total: count() }).from(tasksTable),
    db
      .select({ total: count() })
      .from(tasksTable)
      .where(sql`${tasksTable.createdAt} >= NOW() - INTERVAL '30 days'`),
  ]);

  res.json({
    totalOrgs: Number(orgsRow?.total ?? 0),
    totalUsers: Number(usersRow?.total ?? 0),
    totalTasks: Number(tasksRow?.total ?? 0),
    tasksLast30Days: Number(recentTasksRow?.total ?? 0),
  });
});

// ─── Email / SMTP ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/email/status
 * Return the current SMTP configuration status (no secrets exposed).
 * Includes `source` ("env"|"db") and `hasPassword` boolean.
 */
router.get('/admin/email/status', (_req, res) => {
  res.json(getEmailConfig());
});

/**
 * PUT /api/admin/email/config
 * Persist a new SMTP config override and apply it immediately.
 * The password field is optional — if omitted, the existing password is kept.
 * Body: { host, port, secure, user, pass?, from }
 */
router.put('/admin/email/config', async (req, res) => {
  const body = req.body as {
    host?: unknown;
    port?: unknown;
    secure?: unknown;
    user?: unknown;
    pass?: unknown;
    from?: unknown;
  };

  if (typeof body.host !== 'string' || !body.host.trim()) {
    res.status(400).json({ error: 'host (string) is required' });
    return;
  }
  const portNum = Number(body.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
    return;
  }
  if (typeof body.secure !== 'boolean') {
    res.status(400).json({ error: 'secure (boolean) is required' });
    return;
  }
  if (typeof body.from !== 'string' || !body.from.trim()) {
    res.status(400).json({ error: 'from (string) is required' });
    return;
  }

  const config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass?: string;
    from: string;
  } = {
    host: (body.host as string).trim(),
    port: portNum,
    secure: body.secure as boolean,
    user: typeof body.user === 'string' ? body.user.trim() : '',
    from: (body.from as string).trim(),
  };

  if (typeof body.pass === 'string') {
    config.pass = body.pass;
  }

  try {
    await applySmtpOverride(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface missing-key errors as a clear 500 rather than an unhandled throw.
    if (message.includes('SECRET_ENCRYPTION_KEY')) {
      res.status(500).json({
        error:
          'Server misconfiguration: SECRET_ENCRYPTION_KEY is not set. ' +
          'The SMTP password cannot be encrypted until the environment variable is configured and the server is restarted.',
      });
      return;
    }
    throw err;
  }

  await logAdminAction(req.instanceAdminActor!, 'update_smtp_config', 'smtp', 'default', {
    host: config.host,
    port: config.port,
  });

  res.json(getEmailConfig());
});

/**
 * DELETE /api/admin/email/config
 * Remove the DB override and revert to environment variable values immediately.
 */
router.delete('/admin/email/config', async (req, res) => {
  await clearSmtpOverride();

  await logAdminAction(req.instanceAdminActor!, 'clear_smtp_config', 'smtp', 'default');

  res.json(getEmailConfig());
});

/**
 * POST /api/admin/email/test
 * Send a test email to verify SMTP delivery.
 * Body: { to: string }
 */
router.post('/admin/email/test', async (req, res) => {
  const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!to) {
    res.status(400).json({ success: false, error: '"to" email address is required' });
    return;
  }

  const config = getEmailConfig();
  if (!config.configured) {
    res.status(422).json({ success: false, error: 'SMTP is not configured on this server. Set SMTP_HOST and related environment variables.' });
    return;
  }

  const result = await sendMail({
    to,
    subject: 'Opsly — SMTP test email',
    html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px}.badge{display:inline-block;background:#dcfce7;color:#166534;border-radius:4px;padding:4px 10px;font-size:13px;font-weight:600;margin-bottom:16px}</style>
</head>
<body><div class="card">
  <div class="badge">✓ SMTP working</div>
  <h2 style="margin-top:8px;color:#111827">Test email from Opsly</h2>
  <p style="color:#6b7280">This message confirms that your SMTP configuration is correct and email delivery is working.</p>
  <p style="color:#6b7280;font-size:13px">Sent from: ${config.from}<br>Server: ${config.host}:${config.port}</p>
</div></body></html>`,
  });

  if (result.ok) {
    res.json({ success: true });
  } else {
    res.status(502).json({ success: false, error: result.error });
  }
});

// ─── Audit Log ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-log?limit=50
 * Recent instance admin audit log entries.
 */
router.get('/admin/audit-log', async (req, res) => {
  const limitNum = Math.min(Number(req.query.limit) || 50, 500);

  const rows = await db
    .select()
    .from(instanceAuditLogTable)
    .orderBy(desc(instanceAuditLogTable.createdAt))
    .limit(limitNum);

  res.json(rows);
});

export default router;
