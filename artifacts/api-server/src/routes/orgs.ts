import { Router, type IRouter } from 'express';
import { eq, and, or, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  organizationsTable,
  orgMembersTable,
  invitationsTable,
  usersTable,
  rolesTable,
  slaPoliciesTable,
  workflowStagesTable,
  orgTerminologyTable,
  OWNER_PERMISSIONS,
  ADMIN_PERMISSIONS,
  MEMBER_PERMISSIONS,
  TERMINOLOGY_KEYS,
  TERMINOLOGY_DEFAULTS,
  SINGULAR_TERMINOLOGY_KEYS,
} from '@workspace/db';
import type { RolePermissions, TerminologyKey, SingularTerminologyKey } from '@workspace/db';
import { PatchOrgTerminologyBody, DEFAULT_REACTION_PALETTE } from '@workspace/api-zod';
import { seedDefaultNote } from '../lib/seed-note';
import {
  requireAuth,
  requireOrg,
  requirePermission,
} from '../middlewares/requireOrgMiddleware';
import { pushEvent } from '../lib/sse';
import { requireOrgFeature, getOrgFeatureStates } from '../lib/org-features';
import { seedDefaultStages } from '../lib/workflow-stages';
import { sendMail, buildInviteEmail, isEmailConfigured } from '../lib/email';
import { logger } from '../lib/logger';
import { dispatchMemberJoined, dispatchMemberRemoved } from '../lib/webhook-dispatcher';
import { logOrgEvent } from '../lib/log-org-event';

const router: IRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function actorFromSession(req: { user?: { id?: string; firstName?: string | null; lastName?: string | null; email?: string | null } | null }): { actorId: string | null; actorName: string | null } {
  const u = req.user;
  if (!u) return { actorId: null, actorName: null };
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return { actorId: u.id ?? null, actorName: full || u.email || 'Unknown' };
}

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/**
 * Seed the three built-in roles (Owner, Admin, Member) for a newly created org.
 * Returns the Owner role id so the creator can be assigned to it.
 */
async function seedBuiltInRoles(orgId: string): Promise<{ ownerId: string; memberId: string }> {
  const [ownerRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: 'Owner', isBuiltIn: true, isOwner: true, permissions: OWNER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  await db
    .insert(rolesTable)
    .values({ orgId, name: 'Admin', isBuiltIn: true, isOwner: false, permissions: ADMIN_PERMISSIONS });

  const [memberRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: 'Member', isBuiltIn: true, isOwner: false, permissions: MEMBER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  return { ownerId: ownerRole.id, memberId: memberRole.id };
}

/** Get the Member built-in role id for an org (used when accepting invitations). */
async function getMemberRoleId(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(
      and(
        eq(rolesTable.orgId, orgId),
        eq(rolesTable.isBuiltIn, true),
        sql`${rolesTable.name} = 'Member'`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Fetch and resolve the terminology map for an org (merges custom overrides over defaults).
 *  Also returns any admin-set singular overrides (e.g. projectsSingular) when present. */
async function resolveTerminology(orgId: string): Promise<Record<TerminologyKey, string> & Partial<Record<SingularTerminologyKey, string>>> {
  const rows = await db
    .select({ termKey: orgTerminologyTable.termKey, customLabel: orgTerminologyTable.customLabel })
    .from(orgTerminologyTable)
    .where(eq(orgTerminologyTable.orgId, orgId));

  const result: Record<TerminologyKey, string> & Partial<Record<SingularTerminologyKey, string>> = { ...TERMINOLOGY_DEFAULTS };
  for (const row of rows) {
    if (TERMINOLOGY_KEYS.includes(row.termKey as TerminologyKey)) {
      result[row.termKey as TerminologyKey] = row.customLabel;
    } else if (SINGULAR_TERMINOLOGY_KEYS.includes(row.termKey as SingularTerminologyKey)) {
      result[row.termKey as SingularTerminologyKey] = row.customLabel;
    }
  }
  return result;
}

async function getOrgMeData(userId: string) {
  // Check membership — join with roles to get full permission context
  const [membership] = await db
    .select({
      orgId: orgMembersTable.orgId,
      orgName: organizationsTable.name,
      orgCreatedAt: organizationsTable.createdAt,
      orgPrimaryColor: organizationsTable.primaryColor,
      orgLogoUrl: organizationsTable.logoUrl,
      roleId: orgMembersTable.roleId,
      roleName: rolesTable.name,
      isOwner: rolesTable.isOwner,
      permissions: rolesTable.permissions,
    })
    .from(orgMembersTable)
    .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
    .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
    .where(eq(orgMembersTable.userId, userId))
    .limit(1);

  if (membership) {
    const [features, terminology] = await Promise.all([
      getOrgFeatureStates(membership.orgId),
      resolveTerminology(membership.orgId),
    ]);
    return {
      org: {
        id: membership.orgId,
        name: membership.orgName,
        createdAt: membership.orgCreatedAt.toISOString(),
        primaryColor: membership.orgPrimaryColor ?? null,
        logoUrl: membership.orgLogoUrl ?? null,
      },
      roleId: membership.roleId,
      roleName: membership.roleName,
      permissions: membership.permissions,
      features,
      terminology,
      pendingInvitation: null,
    };
  }

  // No membership — check for pending invitation
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const now = new Date();
  const conditions = [
    eq(invitationsTable.status, 'pending'),
    sql`${invitationsTable.expiresAt} > ${now.toISOString()}`,
  ];
  const matchConditions = [];
  if (user?.email) matchConditions.push(eq(invitationsTable.invitedEmail, user.email));
  matchConditions.push(eq(invitationsTable.invitedUserId, userId));

  const [invitation] = await db
    .select({
      id: invitationsTable.id,
      orgId: invitationsTable.orgId,
      orgName: organizationsTable.name,
      token: invitationsTable.token,
      expiresAt: invitationsTable.expiresAt,
    })
    .from(invitationsTable)
    .innerJoin(organizationsTable, eq(invitationsTable.orgId, organizationsTable.id))
    .where(and(...conditions, or(...matchConditions)))
    .limit(1);

  if (invitation) {
    return {
      org: null,
      roleId: null,
      roleName: null,
      permissions: null,
      pendingInvitation: {
        id: invitation.id,
        orgId: invitation.orgId,
        orgName: invitation.orgName,
        token: invitation.token,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  }

  return { org: null, roleId: null, roleName: null, permissions: null, pendingInvitation: null };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /orgs - create an organization (authenticated, no org required)
router.post('/orgs', requireAuth, async (req, res): Promise<void> => {
  const schema = z.object({ name: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // User must not already belong to an org
  const [existing] = await db
    .select({ orgId: orgMembersTable.orgId })
    .from(orgMembersTable)
    .where(eq(orgMembersTable.userId, req.user!.id))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'You already belong to an organization' });
    return;
  }

  const [org] = await db
    .insert(organizationsTable)
    .values({ name: parsed.data.name })
    .returning();

  // Seed built-in roles and assign creator to Owner
  const { ownerId } = await seedBuiltInRoles(org.id);

  // Seed default workflow stages for this new org
  await seedDefaultStages(org.id);

  // Seed the markdown showcase scratchpad note (Shared / read-only)
  await seedDefaultNote(org.id, req.user!.id);

  await db.insert(orgMembersTable).values({
    orgId: org.id,
    userId: req.user!.id,
    roleId: ownerId,
  });

  res.status(201).json({
    org: { id: org.id, name: org.name, createdAt: org.createdAt.toISOString() },
    roleId: ownerId,
    roleName: 'Owner',
    permissions: OWNER_PERMISSIONS,
    pendingInvitation: null,
  });
});

// GET /orgs/me - current org + role + pending invitation
router.get('/orgs/me', requireAuth, async (req, res): Promise<void> => {
  const data = await getOrgMeData(req.user!.id);
  res.json(data);
});

// PATCH /orgs/me - rename the current organization (admin only)
router.patch('/orgs/me', requireOrg, requirePermission('manage_org_settings'), async (req, res): Promise<void> => {
  const schema = z.object({ name: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Snapshot old name before update
  const [currentOrg] = await db
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, req.orgId!))
    .limit(1);
  const oldName = currentOrg?.name ?? null;

  const [updated] = await db
    .update(organizationsTable)
    .set({ name: parsed.data.name })
    .where(eq(organizationsTable.id, req.orgId!))
    .returning();

  const { actorId, actorName } = actorFromSession(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId,
    actorName,
    category: 'settings',
    action: 'settings.org_renamed',
    targetId: req.orgId!,
    targetName: updated.name,
    metadata: { from: oldName, to: updated.name },
  });

  res.json({
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt.toISOString(),
    primaryColor: updated.primaryColor ?? null,
    logoUrl: updated.logoUrl ?? null,
  });
});

const requireBrandingFeature = requireOrgFeature('branding');

// PATCH /orgs/me/branding - update org branding (manage_org_settings + branding feature required)
router.patch('/orgs/me/branding', requireOrg, requireBrandingFeature, requirePermission('manage_org_settings'), async (req, res): Promise<void> => {
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const schema = z.object({
    primaryColor: z
      .string()
      .regex(HEX_COLOR_RE, 'primaryColor must be a 6-digit hex string like #f59e0b')
      .nullable()
      .optional(),
    logoUrl: z
      .string()
      .url('logoUrl must be a valid URL')
      .refine((u) => /^https?:\/\//i.test(u), 'logoUrl must use http or https')
      .nullable()
      .optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid branding data' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if ('primaryColor' in parsed.data) updates['primaryColor'] = parsed.data.primaryColor ?? null;
  if ('logoUrl' in parsed.data) updates['logoUrl'] = parsed.data.logoUrl ?? null;

  if (Object.keys(updates).length === 0) {
    // Nothing to update — return current state
    const [current] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, req.orgId!))
      .limit(1);
    res.json({
      id: current.id,
      name: current.name,
      createdAt: current.createdAt.toISOString(),
      primaryColor: current.primaryColor ?? null,
      logoUrl: current.logoUrl ?? null,
    });
    return;
  }

  const [updated] = await db
    .update(organizationsTable)
    .set(updates)
    .where(eq(organizationsTable.id, req.orgId!))
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt.toISOString(),
    primaryColor: updated.primaryColor ?? null,
    logoUrl: updated.logoUrl ?? null,
  });
});

// GET /orgs/members - list org members with user info + role details
router.get('/orgs/members', requireOrg, async (req, res): Promise<void> => {
  const members = await db
    .select({
      userId: orgMembersTable.userId,
      roleId: orgMembersTable.roleId,
      roleName: rolesTable.name,
      isOwner: rolesTable.isOwner,
      permissions: rolesTable.permissions,
      joinedAt: orgMembersTable.joinedAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(orgMembersTable)
    .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
    .where(eq(orgMembersTable.orgId, req.orgId!))
    .orderBy(orgMembersTable.joinedAt);

  res.json(
    members.map((m) => ({
      userId: m.userId,
      roleId: m.roleId,
      roleName: m.roleName,
      permissions: m.permissions,
      joinedAt: m.joinedAt.toISOString(),
      firstName: m.firstName ?? null,
      lastName: m.lastName ?? null,
      email: m.email ?? null,
      profileImageUrl: m.profileImageUrl ?? null,
    })),
  );
});

// GET /orgs/invitation-preview/:token - public; returns org name for the invite page
router.get('/orgs/invitation-preview/:token', async (req, res): Promise<void> => {
  const { token } = req.params;
  const now = new Date();

  const [row] = await db
    .select({
      orgName: organizationsTable.name,
      expiresAt: invitationsTable.expiresAt,
      status: invitationsTable.status,
    })
    .from(invitationsTable)
    .innerJoin(organizationsTable, eq(invitationsTable.orgId, organizationsTable.id))
    .where(eq(invitationsTable.token, token))
    .limit(1);

  if (!row || row.status !== 'pending' || row.expiresAt <= now) {
    res.status(404).json({ error: 'Invitation not found or expired' });
    return;
  }

  res.json({ orgName: row.orgName, expiresAt: row.expiresAt.toISOString() });
});

// GET /orgs/invitations - list pending invitations (manage_members required)
router.get('/orgs/invitations', requireOrg, requirePermission('manage_members'), async (req, res): Promise<void> => {
  const now = new Date();
  const invitations = await db
    .select({
      id: invitationsTable.id,
      orgId: invitationsTable.orgId,
      invitedEmail: invitationsTable.invitedEmail,
      invitedUserId: invitationsTable.invitedUserId,
      token: invitationsTable.token,
      status: invitationsTable.status,
      expiresAt: invitationsTable.expiresAt,
      createdAt: invitationsTable.createdAt,
    })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.orgId, req.orgId!),
        eq(invitationsTable.status, 'pending'),
        sql`${invitationsTable.expiresAt} > ${now.toISOString()}`,
      ),
    )
    .orderBy(invitationsTable.createdAt);

  res.json(
    invitations.map((inv) => ({
      id: inv.id,
      orgId: inv.orgId,
      invitedEmail: inv.invitedEmail ?? null,
      invitedUserId: inv.invitedUserId ?? null,
      token: inv.token,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    })),
  );
});

// DELETE /orgs/invitations/:id - cancel a pending invitation
router.delete('/orgs/invitations/:id', requireOrg, requirePermission('manage_members'), async (req, res): Promise<void> => {
  const id = req.params.id as string;

  const [invitation] = await db
    .select({ id: invitationsTable.id, orgId: invitationsTable.orgId })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, id),
        eq(invitationsTable.orgId, req.orgId!),
        eq(invitationsTable.status, 'pending'),
      ),
    )
    .limit(1);

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }

  const { actorId, actorName } = actorFromSession(req);
  await db.delete(invitationsTable).where(eq(invitationsTable.id, id));

  void logOrgEvent({
    orgId: req.orgId!,
    actorId,
    actorName,
    category: 'member',
    action: 'member.invite_cancelled',
    targetId: id,
    targetName: invitation.orgId,
    metadata: null,
  });

  res.status(204).send();
});

// POST /orgs/invite - invite a member
router.post('/orgs/invite', requireOrg, requirePermission('manage_members'), async (req, res): Promise<void> => {
  const schema = z.object({
    email: z.string().email().optional(),
    userId: z.string().min(1).optional(),
  }).refine((d) => d.email || d.userId, {
    message: 'Either email or userId must be provided',
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Check invitee is not already a member
  if (parsed.data.userId) {
    const [alreadyMember] = await db
      .select({ userId: orgMembersTable.userId })
      .from(orgMembersTable)
      .where(
        and(
          eq(orgMembersTable.orgId, req.orgId!),
          eq(orgMembersTable.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (alreadyMember) {
      res.status(409).json({ error: 'User is already a member of this organization' });
      return;
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      orgId: req.orgId!,
      invitedEmail: parsed.data.email ?? null,
      invitedUserId: parsed.data.userId ?? null,
      invitedById: req.user!.id,
      token,
      status: 'pending',
      expiresAt,
    })
    .returning();

  // Send invite email if an email address was provided and SMTP is configured.
  if (parsed.data.email && isEmailConfigured()) {
    // Resolve org name and inviter name for the email body.
    const [orgRow] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, req.orgId!))
      .limit(1);

    const [inviterRow] = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id))
      .limit(1);

    const orgName = orgRow?.name ?? 'your organization';
    const inviterName =
      [inviterRow?.firstName, inviterRow?.lastName].filter(Boolean).join(' ') ||
      inviterRow?.email ||
      'A team member';

    // Derive the app URL: prefer APP_URL env var, fall back to request origin.
    const appUrl =
      (process.env['APP_URL'] ?? '').replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;

    const inviteLink = `${appUrl}/invite/${token}`;

    // Fire-and-forget — don't block the response on email delivery.
    void sendMail({
      to: parsed.data.email,
      subject: `You've been invited to join ${orgName} on Opsly`,
      html: buildInviteEmail({ orgName, inviterName, inviteLink, expiresAt }),
    }).then((result) => {
      if (!result.ok) {
        logger.warn({ email: parsed.data.email, error: result.error }, 'Invite email delivery failed');
      }
    });
  }

  const { actorId, actorName } = actorFromSession(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId,
    actorName,
    category: 'member',
    action: 'member.invited',
    targetId: invitation.invitedUserId ?? null,
    targetName: invitation.invitedEmail ?? invitation.invitedUserId ?? null,
    metadata: null,
  });

  res.status(201).json({
    id: invitation.id,
    orgId: invitation.orgId,
    invitedEmail: invitation.invitedEmail ?? null,
    invitedUserId: invitation.invitedUserId ?? null,
    token: invitation.token,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  });
});

// POST /orgs/invitations/:token/accept - accept invitation
router.post('/orgs/invitations/:token/accept', requireAuth, async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const userId = req.user!.id;
  const now = new Date();

  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.token, token),
        eq(invitationsTable.status, 'pending'),
        sql`${invitationsTable.expiresAt} > ${now.toISOString()}`,
      ),
    )
    .limit(1);

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found or expired' });
    return;
  }

  // Verify this invitation is for the current user
  const emailMatch = user?.email && invitation.invitedEmail === user.email;
  const userIdMatch = invitation.invitedUserId === userId;
  if (!emailMatch && !userIdMatch) {
    res.status(403).json({ error: 'This invitation is not for you' });
    return;
  }

  // Check user doesn't already belong to an org
  const [existingMembership] = await db
    .select({ orgId: orgMembersTable.orgId })
    .from(orgMembersTable)
    .where(eq(orgMembersTable.userId, userId))
    .limit(1);

  if (existingMembership) {
    res.status(409).json({ error: 'You already belong to an organization' });
    return;
  }

  // Get Member role for this org
  const memberRoleId = await getMemberRoleId(invitation.orgId);
  if (!memberRoleId) {
    res.status(500).json({ error: 'Organization roles not initialized — contact an admin' });
    return;
  }

  // Create membership and mark invitation accepted
  await db.insert(orgMembersTable).values({
    orgId: invitation.orgId,
    userId,
    roleId: memberRoleId,
  });

  await db
    .update(invitationsTable)
    .set({ status: 'accepted' })
    .where(eq(invitationsTable.id, invitation.id));

  dispatchMemberJoined(invitation.orgId, { userId, email: user?.email ?? null });

  void logOrgEvent({
    orgId: invitation.orgId,
    actorId: userId,
    actorName: user?.email ?? userId,
    category: 'member',
    action: 'member.joined',
    targetId: userId,
    targetName: user?.email ?? null,
    metadata: null,
  });

  const data = await getOrgMeData(userId);
  res.json(data);
});

// POST /orgs/invitations/:token/decline - decline invitation
router.post('/orgs/invitations/:token/decline', requireAuth, async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const userId = req.user!.id;

  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.token, token),
        eq(invitationsTable.status, 'pending'),
      ),
    )
    .limit(1);

  if (!invitation) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }

  const emailMatch = user?.email && invitation.invitedEmail === user.email;
  const userIdMatch = invitation.invitedUserId === userId;
  if (!emailMatch && !userIdMatch) {
    res.status(403).json({ error: 'This invitation is not for you' });
    return;
  }

  await db
    .update(invitationsTable)
    .set({ status: 'declined' })
    .where(eq(invitationsTable.id, invitation.id));

  res.json({ success: true });
});

// DELETE /orgs/members/:userId - remove a member
router.delete('/orgs/members/:userId', requireOrg, requirePermission('manage_members'), async (req, res): Promise<void> => {
  const targetUserId = req.params.userId as string;

  if (targetUserId === req.user!.id) {
    res.status(400).json({ error: 'You cannot remove yourself from the organization' });
    return;
  }

  // Join with rolesTable so we can check whether the target is an Owner
  const [member] = await db
    .select({ roleId: orgMembersTable.roleId, isOwner: rolesTable.isOwner })
    .from(orgMembersTable)
    .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!member) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  // Non-owners cannot remove Owner-role members
  if (member.isOwner && !req.isOrgOwner) {
    res.status(403).json({ error: 'Only owners can remove other owners' });
    return;
  }

  // Owners cannot be removed if they are the last owner
  if (member.isOwner) {
    const [ownerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orgMembersTable)
      .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
      .where(
        and(
          eq(orgMembersTable.orgId, req.orgId!),
          eq(rolesTable.isOwner, true),
        ),
      );
    if ((ownerCount?.count ?? 0) <= 1) {
      res.status(400).json({ error: 'Cannot remove the last owner. Transfer the Owner role to another member first.' });
      return;
    }
  }

  // Fetch email for webhook payload before delete
  const [removedUser] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);

  await db
    .delete(orgMembersTable)
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.userId, targetUserId),
      ),
    );

  dispatchMemberRemoved(req.orgId!, { userId: targetUserId, email: removedUser?.email ?? null });

  const { actorId: removeActorId, actorName: removeActorName } = actorFromSession(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId: removeActorId,
    actorName: removeActorName,
    category: 'member',
    action: 'member.removed',
    targetId: targetUserId,
    targetName: removedUser?.email ?? targetUserId,
    metadata: null,
  });

  res.sendStatus(204);
});

// PATCH /orgs/members/:userId/role - assign a role to a member (manage_members required)
router.patch('/orgs/members/:userId/role', requireOrg, requirePermission('manage_members'), async (req, res): Promise<void> => {
  const targetUserId = req.params.userId as string;
  const schema = z.object({ roleId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Owners cannot change their own role — ownership must be transferred by
  // assigning the Owner role to another member instead.
  if (targetUserId === req.user!.id && req.isOrgOwner) {
    res.status(403).json({ error: 'Owners cannot change their own role. Assign the Owner role to another member instead.' });
    return;
  }

  // Join with rolesTable to get current role info alongside the membership
  const [member] = await db
    .select({ roleId: orgMembersTable.roleId, currentRoleIsOwner: rolesTable.isOwner })
    .from(orgMembersTable)
    .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!member) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  // Non-owners cannot modify Owner-role members
  if (member.currentRoleIsOwner && !req.isOrgOwner) {
    res.status(403).json({ error: 'Only owners can change the role of another owner' });
    return;
  }

  // Verify the target role belongs to this org
  const [targetRole] = await db
    .select()
    .from(rolesTable)
    .where(
      and(
        eq(rolesTable.id, parsed.data.roleId),
        eq(rolesTable.orgId, req.orgId!),
      ),
    )
    .limit(1);

  if (!targetRole) {
    res.status(404).json({ error: 'Role not found in this organization' });
    return;
  }

  // Only owners can assign the Owner role
  if (targetRole.isOwner && !req.isOrgOwner) {
    res.status(403).json({ error: 'Only owners can assign the Owner role' });
    return;
  }

  // Assigning the Owner role is an ownership TRANSFER: the acting owner is
  // demoted to the built-in Admin role in the same request so the org never
  // ends up with two owners (which desyncs role data across members).
  let demoteActingOwnerToRoleId: string | null = null;
  if (targetRole.isOwner && req.isOrgOwner) {
    const [adminRole] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(
        and(
          eq(rolesTable.orgId, req.orgId!),
          eq(rolesTable.isBuiltIn, true),
          eq(rolesTable.name, 'Admin'),
        ),
      )
      .limit(1);
    if (!adminRole) {
      res.status(500).json({ error: 'Built-in Admin role not found; cannot transfer ownership' });
      return;
    }
    demoteActingOwnerToRoleId = adminRole.id;
  }

  // If demoting an Owner, ensure at least one other Owner remains
  if (member.currentRoleIsOwner && !targetRole.isOwner) {
    const [ownerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orgMembersTable)
      .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
      .where(
        and(
          eq(orgMembersTable.orgId, req.orgId!),
          eq(rolesTable.isOwner, true),
        ),
      );
    if ((ownerCount?.count ?? 0) <= 1) {
      res.status(400).json({ error: 'Cannot demote the last owner. Assign the Owner role to another member first.' });
      return;
    }
  }

  // Ownership transfers perform both writes atomically: if either the
  // promotion or the demotion fails, neither is committed — the org can
  // never be left with two owners.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orgMembersTable)
      .set({ roleId: parsed.data.roleId })
      .where(
        and(
          eq(orgMembersTable.orgId, req.orgId!),
          eq(orgMembersTable.userId, targetUserId),
        ),
      )
      .returning();

    if (!row) {
      throw new Error('Failed to update member role');
    }

    // Complete the ownership transfer: demote the previous owner to Admin
    if (demoteActingOwnerToRoleId) {
      const [demoted] = await tx
        .update(orgMembersTable)
        .set({ roleId: demoteActingOwnerToRoleId })
        .where(
          and(
            eq(orgMembersTable.orgId, req.orgId!),
            eq(orgMembersTable.userId, req.user!.id),
          ),
        )
        .returning();
      if (!demoted) {
        throw new Error('Failed to demote previous owner');
      }
    }

    return row;
  });

  const [userInfo] = await db
    .select({
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);

  // If this was an ownership transfer, instantly notify the new owner's
  // open SSE connection so their session reacts without waiting for polling.
  if (demoteActingOwnerToRoleId) {
    pushEvent(targetUserId, 'role-changed', { newRole: 'Owner' });
  }

  const { actorId: roleActorId, actorName: roleActorName } = actorFromSession(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId: roleActorId,
    actorName: roleActorName,
    category: 'member',
    action: 'member.role_changed',
    targetId: targetUserId,
    targetName: userInfo ? ([userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ') || userInfo.email || targetUserId) : targetUserId,
    metadata: { from: member.currentRoleIsOwner ? 'Owner' : 'previous', to: targetRole.name },
  });

  res.json({
    userId: updated.userId,
    roleId: updated.roleId,
    roleName: targetRole.name,
    permissions: targetRole.permissions,
    joinedAt: updated.joinedAt.toISOString(),
    firstName: userInfo?.firstName ?? null,
    lastName: userInfo?.lastName ?? null,
    email: userInfo?.email ?? null,
    profileImageUrl: userInfo?.profileImageUrl ?? null,
  });
});

// POST /orgs/leave - leave the current organization
router.post('/orgs/leave', requireOrg, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId = req.orgId!;

  // Count total members
  const [memberCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembersTable)
    .where(eq(orgMembersTable.orgId, orgId));

  const totalMembers = memberCount?.count ?? 0;

  if (totalMembers <= 1) {
    // Sole member - delete the org entirely (cascades to projects, tasks, notes, etc.)
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
    res.json({ success: true });
    return;
  }

  // Check owner constraint — owners must transfer ownership before leaving
  if (req.isOrgOwner) {
    const [ownerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orgMembersTable)
      .innerJoin(rolesTable, eq(orgMembersTable.roleId, rolesTable.id))
      .where(
        and(
          eq(orgMembersTable.orgId, orgId),
          eq(rolesTable.isOwner, true),
        ),
      );

    if ((ownerCount?.count ?? 0) <= 1) {
      res.status(400).json({
        error: 'Transfer the Owner role to another member before leaving',
      });
      return;
    }
  }

  // Fetch email for webhook payload before delete
  const [leavingUser] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  await db
    .delete(orgMembersTable)
    .where(
      and(
        eq(orgMembersTable.orgId, orgId),
        eq(orgMembersTable.userId, userId),
      ),
    );

  dispatchMemberRemoved(orgId, { userId, email: leavingUser?.email ?? null });

  void logOrgEvent({
    orgId,
    actorId: userId,
    actorName: leavingUser?.email ?? userId,
    category: 'member',
    action: 'member.left',
    targetId: userId,
    targetName: leavingUser?.email ?? null,
    metadata: null,
  });

  res.json({ success: true });
});

// ─── Terminology ──────────────────────────────────────────────────────────────

// GET /orgs/terminology - return resolved terminology map for calling org
router.get('/orgs/terminology', requireOrg, async (req, res): Promise<void> => {
  const terminology = await resolveTerminology(req.orgId!);
  res.json(terminology);
});

// PATCH /orgs/terminology - upsert term overrides (manage_terminology required)
router.patch('/orgs/terminology', requireOrg, requirePermission('manage_terminology'), async (req, res): Promise<void> => {
  const parsed = PatchOrgTerminologyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'At least one terminology key must be provided' });
    return;
  }

  const orgId = req.orgId!;
  const now = new Date();

  // Upsert or clear each supplied key individually (both plural and optional singular overrides)
  const allValidKeys = new Set<string>([...TERMINOLOGY_KEYS, ...SINGULAR_TERMINOLOGY_KEYS]);
  for (const [key, label] of Object.entries(parsed.data)) {
    if (!allValidKeys.has(key)) continue;
    if (label === null) {
      // null means "clear this singular override" — delete the row so the app falls back to auto-derived
      await db
        .delete(orgTerminologyTable)
        .where(and(eq(orgTerminologyTable.orgId, orgId), eq(orgTerminologyTable.termKey, key)));
    } else if (label !== undefined) {
      await db
        .insert(orgTerminologyTable)
        .values({ orgId, termKey: key, customLabel: label as string, updatedAt: now })
        .onConflictDoUpdate({
          target: [orgTerminologyTable.orgId, orgTerminologyTable.termKey],
          set: { customLabel: label as string, updatedAt: now },
        });
    }
  }

  const terminology = await resolveTerminology(orgId);
  res.json(terminology);
});

// ─── SLA Policies ─────────────────────────────────────────────────────────────

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const requireSlaTrackingFeature = requireOrgFeature('sla_tracking');

// GET /org/sla-policies - get SLA policies for the current org (org-level only)
router.get('/org/sla-policies', requireOrg, requireSlaTrackingFeature, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const policies = await db
    .select()
    .from(slaPoliciesTable)
    .where(and(eq(slaPoliciesTable.orgId, orgId), isNull(slaPoliciesTable.projectId)));
  res.json(
    policies.map((p) => ({
      ...p,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    })),
  );
});

// PUT /org/sla-policies - upsert SLA policies (admin only)
router.put('/org/sla-policies', requireOrg, requireSlaTrackingFeature, requirePermission('manage_sla_policies'), async (req, res): Promise<void> => {
  const schema = z.object({
    policies: z
      .array(
        z.object({
          priority: z.enum(['low', 'medium', 'high', 'critical']),
          responseMinutes: z.number().int().min(1).nullable().optional(),
          resolutionMinutes: z.number().int().min(1).nullable().optional(),
          warningThresholdPercent: z.number().int().min(1).max(99).optional(),
        }),
      )
      .max(4),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Validate no duplicate priorities in the request body
  const priorities = parsed.data.policies.map((p) => p.priority);
  if (new Set(priorities).size !== priorities.length) {
    res.status(400).json({ error: 'Duplicate priority values are not allowed. Each priority must appear at most once.' });
    return;
  }

  const orgId = req.orgId!;

  // Delete all existing org-level policies then re-insert (simpler than per-priority upsert)
  await db.delete(slaPoliciesTable).where(and(eq(slaPoliciesTable.orgId, orgId), isNull(slaPoliciesTable.projectId)));

  const toInsert = parsed.data.policies.filter(
    (p) => p.responseMinutes != null || p.resolutionMinutes != null,
  );

  let result: typeof slaPoliciesTable.$inferSelect[] = [];
  if (toInsert.length > 0) {
    result = await db
      .insert(slaPoliciesTable)
      .values(
        toInsert.map((p) => ({
          orgId,
          priority: p.priority,
          responseMinutes: p.responseMinutes ?? null,
          resolutionMinutes: p.resolutionMinutes ?? null,
          warningThresholdPercent: p.warningThresholdPercent ?? 80,
        })),
      )
      .returning();
  }

  const { actorId: slaActorId, actorName: slaActorName } = actorFromSession(req);
  void logOrgEvent({
    orgId,
    actorId: slaActorId,
    actorName: slaActorName,
    category: 'settings',
    action: 'settings.sla_policies_updated',
    targetId: orgId,
    targetName: null,
    metadata: { count: result.length },
  });

  res.json(
    result.map((p) => ({
      ...p,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    })),
  );
});

// ─── Reaction palette ─────────────────────────────────────────────────────────

/**
 * Validate that a string is a single grapheme cluster (i.e. a single visible
 * Unicode character such as an emoji). We use Intl.Segmenter when available
 * and fall back to a length check otherwise.
 *
 * Additionally rejects strings that are whitespace-only or consist entirely
 * of invisible Unicode characters (zero-width spaces, BOM, variation
 * selectors, directional/format markers, etc.) that would render as a blank
 * pill in the UI.
 */

/**
 * Matches strings made up exclusively of invisible/non-printing Unicode code
 * points that would appear blank in the reaction UI:
 *   \u00AD   soft hyphen
 *   \u034F   combining grapheme joiner
 *   \u061C   Arabic letter mark
 *   \u115F   Hangul choseong filler
 *   \u1160   Hangul jungseong filler
 *   \u17B4-\u17B5  Khmer inherent vowel
 *   \u180B-\u180D  Mongolian free variation selectors
 *   \u180E   Mongolian vowel separator
 *   \u200B-\u200F  zero-width space/ZWNJ/ZWJ/LRM/RLM
 *   \u202A-\u202F  directional formatting characters
 *   \u2060-\u206F  word joiner, invisible operators, etc.
 *   \uFE00-\uFE0F  variation selectors 1–16
 *   \uFEFF   BOM / zero-width no-break space
 */
const INVISIBLE_ONLY_RE =
  /^[\s\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202F\u2060-\u206F\uFE00-\uFE0F\uFEFF]+$/u;

function isSingleEmoji(str: string): boolean {
  if (!str) return false;
  // Reject whitespace-only and invisible-character-only strings
  if (INVISIBLE_ONLY_RE.test(str)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segmenter = new (Intl as any).Segmenter();
    const segments = [...segmenter.segment(str)];
    return segments.length === 1;
  } catch {
    // Rough fallback: allow strings up to 8 code-points (covers ZWJ sequences)
    return [...str].length <= 8;
  }
}

// GET /orgs/reaction-palette — returns the org's active palette
router.get('/orgs/reaction-palette', requireOrg, async (req, res): Promise<void> => {
  const [org] = await db
    .select({ reactionPalette: organizationsTable.reactionPalette })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, req.orgId!))
    .limit(1);

  const palette =
    org?.reactionPalette && org.reactionPalette.length > 0
      ? org.reactionPalette
      : DEFAULT_REACTION_PALETTE;

  res.json({ palette });
});

// PATCH /orgs/reaction-palette — update the org's reaction palette
router.patch('/orgs/reaction-palette', requireOrg, requirePermission('manage_reactions'), async (req, res): Promise<void> => {
  const schema = z.object({
    palette: z
      .array(z.string())
      .min(1, 'Palette must contain at least one emoji'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Validate each entry is a single unicode emoji (grapheme cluster)
  const invalidEntries = parsed.data.palette.filter((e) => !isSingleEmoji(e));
  if (invalidEntries.length > 0) {
    res.status(422).json({
      error: `Invalid emoji entries (each must be a single unicode character): ${invalidEntries.join(', ')}`,
    });
    return;
  }

  // Deduplicate while preserving order
  const palette = [...new Set(parsed.data.palette)];

  await db
    .update(organizationsTable)
    .set({ reactionPalette: palette })
    .where(eq(organizationsTable.id, req.orgId!));

  res.json({ palette });
});

export default router;
