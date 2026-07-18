import { Router, type IRouter } from 'express';
import { eq, and, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  organizationsTable,
  orgMembersTable,
  invitationsTable,
  usersTable,
} from '@workspace/db';
import { requireAuth, requireOrg, requireAdmin } from '../middlewares/requireOrgMiddleware';

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

async function getOrgMeData(userId: string) {
  // Check membership
  const [membership] = await db
    .select({
      orgId: orgMembersTable.orgId,
      role: orgMembersTable.role,
      orgName: organizationsTable.name,
      orgCreatedAt: organizationsTable.createdAt,
    })
    .from(orgMembersTable)
    .innerJoin(organizationsTable, eq(orgMembersTable.orgId, organizationsTable.id))
    .where(eq(orgMembersTable.userId, userId))
    .limit(1);

  if (membership) {
    return {
      org: {
        id: membership.orgId,
        name: membership.orgName,
        createdAt: membership.orgCreatedAt.toISOString(),
      },
      role: membership.role,
      pendingInvitation: null,
    };
  }

  // No membership — check for pending invitation
  // Fetch the user's email to match against invitations
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
      role: null,
      pendingInvitation: {
        id: invitation.id,
        orgId: invitation.orgId,
        orgName: invitation.orgName,
        token: invitation.token,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  }

  return { org: null, role: null, pendingInvitation: null };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /orgs — create an organization (authenticated, no org required)
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

  await db.insert(orgMembersTable).values({
    orgId: org.id,
    userId: req.user!.id,
    role: 'admin',
  });

  res.status(201).json({
    org: { id: org.id, name: org.name, createdAt: org.createdAt.toISOString() },
    role: 'admin',
    pendingInvitation: null,
  });
});

// GET /orgs/me — current org + role + pending invitation
router.get('/orgs/me', requireAuth, async (req, res): Promise<void> => {
  const data = await getOrgMeData(req.user!.id);
  res.json(data);
});

// PATCH /orgs/me — rename the current organization (admin only)
router.patch('/orgs/me', requireOrg, requireAdmin, async (req, res): Promise<void> => {
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

// GET /orgs/members — list org members with user info
router.get('/orgs/members', requireOrg, async (req, res): Promise<void> => {
  const members = await db
    .select({
      userId: orgMembersTable.userId,
      role: orgMembersTable.role,
      joinedAt: orgMembersTable.joinedAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(orgMembersTable)
    .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
    .where(eq(orgMembersTable.orgId, req.orgId!))
    .orderBy(orgMembersTable.joinedAt);

  res.json(
    members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      firstName: m.firstName ?? null,
      lastName: m.lastName ?? null,
      email: m.email ?? null,
      profileImageUrl: m.profileImageUrl ?? null,
    })),
  );
});

// GET /orgs/invitation-preview/:token — public; returns org name for the invite page
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

// GET /orgs/invitations — list pending invitations (admin only)
router.get('/orgs/invitations', requireOrg, requireAdmin, async (req, res): Promise<void> => {
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

// DELETE /orgs/invitations/:id — cancel a pending invitation (admin only)
router.delete('/orgs/invitations/:id', requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const { id } = req.params;

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

// POST /orgs/invite — invite a member (admin only)
router.post('/orgs/invite', requireOrg, requireAdmin, async (req, res): Promise<void> => {
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

// POST /orgs/invitations/:token/accept — accept invitation
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

  // Create membership and mark invitation accepted
  await db.insert(orgMembersTable).values({
    orgId: invitation.orgId,
    userId,
    role: 'member',
  });

  await db
    .update(invitationsTable)
    .set({ status: 'accepted' })
    .where(eq(invitationsTable.id, invitation.id));

  const data = await getOrgMeData(userId);
  res.json(data);
});

// POST /orgs/invitations/:token/decline — decline invitation
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

// DELETE /orgs/members/:userId — remove a member (admin only)
router.delete('/orgs/members/:userId', requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const targetUserId = req.params.userId as string;

  if (targetUserId === req.user!.id) {
    res.status(400).json({ error: 'You cannot remove yourself from the organization' });
    return;
  }

  const [member] = await db
    .select()
    .from(orgMembersTable)
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

  await db
    .delete(orgMembersTable)
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.userId, targetUserId),
      ),
    );

  res.sendStatus(204);
});

// PATCH /orgs/members/:userId/role — transfer admin / change role (admin only)
router.patch('/orgs/members/:userId/role', requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const targetUserId = req.params.userId as string;
  const schema = z.object({ role: z.enum(['admin', 'member']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [member] = await db
    .select()
    .from(orgMembersTable)
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

  // If promoting to admin, demote current admin to member
  if (parsed.data.role === 'admin') {
    await db
      .update(orgMembersTable)
      .set({ role: 'member' })
      .where(
        and(
          eq(orgMembersTable.orgId, req.orgId!),
          eq(orgMembersTable.userId, req.user!.id),
        ),
      );
  }

  const [updated] = await db
    .update(orgMembersTable)
    .set({ role: parsed.data.role })
    .where(
      and(
        eq(orgMembersTable.orgId, req.orgId!),
        eq(orgMembersTable.userId, targetUserId),
      ),
    )
    .returning();

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

  res.json({
    userId: updated.userId,
    role: updated.role,
    joinedAt: updated.joinedAt.toISOString(),
    firstName: userInfo?.firstName ?? null,
    lastName: userInfo?.lastName ?? null,
    email: userInfo?.email ?? null,
    profileImageUrl: userInfo?.profileImageUrl ?? null,
  });
});

// POST /orgs/leave — leave the current organization
router.post('/orgs/leave', requireOrg, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const orgId = req.orgId!;

  // Count total members to decide whether to delete the org or just remove self
  const [memberCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembersTable)
    .where(eq(orgMembersTable.orgId, orgId));

  const totalMembers = memberCount?.count ?? 0;

  if (totalMembers <= 1) {
    // Sole member — delete the org entirely (cascades to projects, tasks, notes, etc.)
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
    res.json({ success: true });
    return;
  }

  // More than one member — check admin constraint
  if (req.orgRole === 'admin') {
    const [adminCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orgMembersTable)
      .where(
        and(
          eq(orgMembersTable.orgId, orgId),
          eq(orgMembersTable.role, 'admin'),
        ),
      );

    if ((adminCount?.count ?? 0) <= 1) {
      res.status(400).json({
        error: 'Transfer admin to another member before leaving',
      });
      return;
    }
  }

  await db
    .delete(orgMembersTable)
    .where(
      and(
        eq(orgMembersTable.orgId, orgId),
        eq(orgMembersTable.userId, userId),
      ),
    );

  res.json({ success: true });
});

export default router;
