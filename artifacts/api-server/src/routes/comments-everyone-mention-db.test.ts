/**
 * Live-database integration test: @[everyone] mention scoping.
 *
 * Confirms that a @[everyone] comment notifies ONLY users who have an active
 * row in orgMembersTable — not users who only have a pending invitation row
 * and no membership, and not users who have been removed (no row at all).
 *
 * The suite hits a real PostgreSQL database so the orgMembersTable query in
 * comments.ts runs against actual data.  The notifications module is spied on
 * (not called for real) so we can assert the exact recipientUserIds argument.
 *
 * The suite skips automatically when DATABASE_URL is not set.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Skip when no live database is available
// ---------------------------------------------------------------------------
const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Mutable context — populated in beforeAll, injected by the middleware mock
// ---------------------------------------------------------------------------
const ctx = vi.hoisted(() => ({
  orgId: "",
  actorUserId: "placeholder",
}));

// ---------------------------------------------------------------------------
// Notification spy — must be hoisted before vi.mock calls
// ---------------------------------------------------------------------------
const notifyMentionsSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ---------------------------------------------------------------------------
// Mock ONLY the auth/org middleware — real DB for every query
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = ctx.orgId;
    req.user  = { id: ctx.actorUserId };
    req.orgPermissions = {};
    next();
  },
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = ctx.orgId;
    req.user  = { id: ctx.actorUserId };
    req.orgPermissions = {};
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: ctx.actorUserId };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireOwner: (_req: any, _res: any, next: any) => next(),
  requirePermission: (_key: string) => (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// @workspace/api-zod — passthrough so route validators always succeed
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
    CreateCommentBody: p,
    CreateCommentParams: p,
    ListCommentsParams: p,
    DeleteCommentParams: p,
    ListCommentsResponse: p,
    CreateCommentResponse: p,
    DeleteCommentResponse: p,
    UpdateCommentBody: p,
    UpdateCommentParams: p,
    UpdateCommentResponse: p,
    AddReactionParams: p,
    AddReactionBody: p,
    DeleteReactionParams: p,
    DEFAULT_REACTION_PALETTE: [],
  };
});

// ---------------------------------------------------------------------------
// Stub side-effect modules — no network, email, or SSE in tests
// ---------------------------------------------------------------------------
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCommented: () => {},
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
}));

vi.mock("../lib/notifications", () => ({
  notifyMentions: notifyMentionsSpy,
  notifyCommentAdded: async () => {},
  notifyCommentReply: async () => {},
}));

vi.mock("../lib/resolve-custom-fields", () => ({
  resolveCustomFieldNames: async () => ({}),
}));

vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Import real route AFTER mocks are in place
// ---------------------------------------------------------------------------
import commentsRouter from "./comments.js";

// Real DB — not mocked
import {
  db,
  organizationsTable,
  rolesTable,
  orgMembersTable,
  usersTable,
  invitationsTable,
  tasksTable,
  workflowStagesTable,
  MEMBER_PERMISSIONS,
  OWNER_PERMISSIONS,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Minimal express app
// ---------------------------------------------------------------------------
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", commentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[test app error]", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Seed state
// ---------------------------------------------------------------------------
let orgId: string;
let actorUserId: string;       // the commenter — excluded from self-notification
let activeMemberUserId: string; // has an orgMember row → should be notified
let pendingInviteUserId: string; // has only an invitations row → must NOT be notified

let taskId: number;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function createUser(suffix: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `everyone-mention-test-${suffix}-${Date.now()}@test.local`,
      firstName: "Test",
      lastName: suffix,
    })
    .returning({ id: usersTable.id });
  return user.id;
}

// ---------------------------------------------------------------------------
// Seed org, users, memberships, invitation, and task before tests run
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Org
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: "Everyone Mention Scoping Test Org" })
    .returning({ id: organizationsTable.id });
  orgId = org.id;

  // Users
  actorUserId        = await createUser("actor");
  activeMemberUserId = await createUser("active-member");
  pendingInviteUserId = await createUser("pending-invite");

  // Update ctx so the middleware mock injects the correct orgId + actorId
  ctx.orgId = orgId;
  ctx.actorUserId = actorUserId;

  // Roles
  const [ownerRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Owner", isBuiltIn: true, isOwner: true, permissions: OWNER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  const [memberRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Member", isBuiltIn: true, isOwner: false, permissions: MEMBER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  // Active memberships: actor + activeMember only
  // pendingInviteUser is deliberately NOT inserted into orgMembersTable
  await db.insert(orgMembersTable).values([
    { orgId, userId: actorUserId,        roleId: ownerRole.id  },
    { orgId, userId: activeMemberUserId, roleId: memberRole.id },
  ]);

  // Pending invitation for pendingInviteUser — this user is NOT a member
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(invitationsTable).values({
    orgId,
    invitedEmail: `pending-invite-${Date.now()}@test.local`,
    invitedUserId: pendingInviteUserId,
    invitedById: actorUserId,
    token: `test-token-${Date.now()}`,
    status: "pending",
    expiresAt,
  });

  // Workflow stage + task
  const [stage] = await db
    .insert(workflowStagesTable)
    .values({ orgId, name: "Open", color: "#6b7280", type: "open", position: 0 })
    .returning({ id: workflowStagesTable.id });

  const [task] = await db
    .insert(tasksTable)
    .values({
      orgId,
      orgTaskNumber: 1,
      title: "Everyone Mention Test Task",
      status: String(stage.id),
      priority: "medium",
      category: "other",
    })
    .returning({ id: tasksTable.id });
  taskId = task.id;
});

// ---------------------------------------------------------------------------
// Tear down all seeded data after the suite completes
// ---------------------------------------------------------------------------
afterAll(async () => {
  if (orgId) {
    // Cascade-deletes: memberships, roles, invitations, tasks, comments
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  }
  const userIds = [actorUserId, activeMemberUserId, pendingInviteUserId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describeIf(
  "@[everyone] mention — only active orgMember rows receive the notification",
  () => {
    it(
      "notifies the active member and excludes the commenter and the pending-invite user",
      async () => {
        notifyMentionsSpy.mockClear();

        const res = await request(buildApp())
          .post(`/api/tasks/${taskId}/comments`)
          .send({ content: "@[everyone] please see this update" });

        expect(res.status).toBe(201);

        // The @[everyone] notification is fired in a background IIFE; wait for it
        await vi.waitFor(
          () => {
            expect(notifyMentionsSpy).toHaveBeenCalledOnce();
          },
          { timeout: 5000 },
        );

        const call = notifyMentionsSpy.mock.calls[0][0];
        const recipients: string[] = call.recipientUserIds;

        // The active member must receive the mention
        expect(recipients).toContain(activeMemberUserId);

        // The commenter (actor) must NOT receive their own mention
        expect(recipients).not.toContain(actorUserId);

        // The pending-invite user has no orgMember row — they must NOT be notified
        expect(recipients).not.toContain(pendingInviteUserId);
      },
    );

    it(
      "confirms pendingInviteUser has no orgMember row (DB-level assertion)",
      async () => {
        // Belt-and-suspenders: directly verify the pending-invite user was
        // never inserted into orgMembersTable.  If this assertion fails, the
        // seeding in beforeAll is wrong, not the production code.
        const rows = await db
          .select({ userId: orgMembersTable.userId })
          .from(orgMembersTable)
          .where(eq(orgMembersTable.orgId, orgId));

        const memberUserIds = rows.map((r) => r.userId);
        expect(memberUserIds).toContain(activeMemberUserId);
        expect(memberUserIds).toContain(actorUserId);
        expect(memberUserIds).not.toContain(pendingInviteUserId);
      },
    );
  },
);
