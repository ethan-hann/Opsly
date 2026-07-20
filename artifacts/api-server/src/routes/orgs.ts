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
  OWNER_PERMISSIONS,
  ADMIN_PERMISSIONS,
  MEMBER_PERMISSIONS,
} from '@workspace/db';
import type { RolePermissions } from '@workspace/db';
import {
  requireAuth,
  requireOrg,
  requirePermission,
} from '../middlewares/requireOrgMiddleware';
import { pushEvent } from '../lib/sse';
import { seedDefaultStages } from '../lib/workflow-stages';
import { sendMail, buildInviteEmail, isEmailConfigured } from '../lib/email';
import { logger } from '../lib/logger';
import { dispatchMemberJoined, dispatchMemberRemoved } from '../lib/webhook-dispatcher';

const router: IRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function getOrgMeData(userId: string) {
  // Check membership — join with roles to get full permission context
  const [membership] = await db
    .select({
      orgId: orgMembersTable.orgId,
      orgName: organizationsTable.name,
      orgCreatedAt: organizationsTable.createdAt,
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
    return {
      org: {
        id: membership.orgId,
        name: membership.orgName,
        createdAt: membership.orgCreatedAt.toISOString(),
      },
      roleId: membership.roleId,
      roleName: membership.roleName,
      permissions: membership.permissions,
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

  const [updated] = await db
    .update(organizationsTable)
    .set({ name: parsed.data.name })
    .where(eq(organizationsTable.id, req.orgId!))
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt.toISOString(),
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

  await db.delete(invitationsTable).where(eq(invitationsTable.id, id));
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
      subject: `You've been invited to join ${orgName} on IT Task Manager`,
      html: buildInviteEmail({ orgName, inviterName, inviteLink, expiresAt }),
    }).then((result) => {
      if (!result.ok) {
        logger.warn({ email: parsed.data.email, error: result.error }, 'Invite email delivery failed');
      }
    });
  }

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

  res.json({ success: true });
});

// ─── SLA Policies ─────────────────────────────────────────────────────────────

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

// GET /org/sla-policies - get SLA policies for the current org (org-level only)
router.get('/org/sla-policies', requireOrg, async (req, res): Promise<void> => {
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
router.put('/org/sla-policies', requireOrg, requirePermission('manage_sla_policies'), async (req, res): Promise<void> => {
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

  res.json(
    result.map((p) => ({
      ...p,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    })),
  );
});

export default router;
