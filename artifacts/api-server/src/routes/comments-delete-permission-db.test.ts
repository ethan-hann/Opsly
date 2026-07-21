/**
 * Live-database permission gate integration test: DELETE /api/comments/:id
 *
 * Confirms that the delete_comments permission correctly gates comment
 * moderation against a real PostgreSQL database — catching query-level issues
 * that the mock-based unit tests in comments.test.ts cannot detect.
 *
 * The suite skips automatically when DATABASE_URL is not set.
 *
 * Scenarios covered:
 *  - Member (delete_comments: false) → 403 deleting another user's comment
 *  - Admin  (delete_comments: true)  → 204 deleting another user's comment
 *  - Comment owner can always delete their own comment regardless of delete_comments
 *  - Custom role with delete_comments revoked → 403 after permission update in DB
 *  - Soft-deleted row is stamped in the DB (deletedAt not null after 204)
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Skip when no live database is available
// ---------------------------------------------------------------------------
const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Mutable context injected into the middleware mock for per-test control
// ---------------------------------------------------------------------------
const ctx = vi.hoisted(() => ({
  orgId: "",
  userId: "placeholder",
  permissions: {} as Record<string, boolean>,
}));

// ---------------------------------------------------------------------------
// Mock ONLY the auth/org middleware — real DB used for all queries
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = ctx.orgId;
    req.user = { id: ctx.userId };
    req.orgPermissions = { ...ctx.permissions };
    next();
  },
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = ctx.orgId;
    req.user = { id: ctx.userId };
    req.orgPermissions = { ...ctx.permissions };
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: ctx.userId };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireOwner: (_req: any, _res: any, next: any) => next(),
  requirePermission: (_key: string) => (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// @workspace/api-zod — passthrough (all symbols used by comments.ts)
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
// Stub side-effect modules — no network/email/SSE in tests
// ---------------------------------------------------------------------------
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCommented: () => {},
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
}));

vi.mock("../lib/notifications", () => ({
  notifyCommentAdded: async () => {},
  notifyMentions: async () => {},
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
  tasksTable,
  commentsTable,
  workflowStagesTable,
  ADMIN_PERMISSIONS,
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
let ownerUserId: string;
let memberUserId: string;
let adminUserId: string;
let taskId: number;
let customRoleId: string;
let customUserId: string;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function createUser(suffix: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `delete-comments-test-${suffix}-${Date.now()}@test.local`,
      firstName: "Test",
      lastName: suffix,
    })
    .returning({ id: usersTable.id });
  return user.id;
}

/** Insert a comment authored by userId and return its id. */
async function seedComment(
  userId: string | null,
  content = "Test comment",
): Promise<number> {
  const [c] = await db
    .insert(commentsTable)
    .values({ orgId, taskId, content, author: "tester", userId })
    .returning({ id: commentsTable.id });
  return c.id;
}

// ---------------------------------------------------------------------------
// Seed org, users, roles, and a task before any test runs
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Org
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: "Delete-Comments Permission Test Org" })
    .returning({ id: organizationsTable.id });
  orgId = org.id;
  ctx.orgId = orgId;

  // Users
  ownerUserId = await createUser("owner");
  memberUserId = await createUser("member");
  adminUserId = await createUser("admin");
  customUserId = await createUser("custom");

  // Built-in roles
  const [ownerRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Owner", isBuiltIn: true, isOwner: true, permissions: OWNER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  const [adminRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Admin", isBuiltIn: true, isOwner: false, permissions: ADMIN_PERMISSIONS })
    .returning({ id: rolesTable.id });

  const [memberRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Member", isBuiltIn: true, isOwner: false, permissions: MEMBER_PERMISSIONS })
    .returning({ id: rolesTable.id });

  // Custom role — starts with delete_comments: true (Moderator)
  const [customRole] = await db
    .insert(rolesTable)
    .values({
      orgId,
      name: "Moderator",
      isBuiltIn: false,
      isOwner: false,
      permissions: { ...MEMBER_PERMISSIONS, delete_comments: true },
    })
    .returning({ id: rolesTable.id });
  customRoleId = customRole.id;

  // Memberships
  await db.insert(orgMembersTable).values([
    { orgId, userId: ownerUserId,  roleId: ownerRole.id  },
    { orgId, userId: adminUserId,  roleId: adminRole.id  },
    { orgId, userId: memberUserId, roleId: memberRole.id },
    { orgId, userId: customUserId, roleId: customRole.id },
  ]);

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
      title: "Delete-Comments Permission Test Task",
      status: String(stage.id),
      priority: "medium",
      category: "other",
    })
    .returning({ id: tasksTable.id });
  taskId = task.id;
});

// ---------------------------------------------------------------------------
// Remove all seeded data after the suite completes
// ---------------------------------------------------------------------------
afterAll(async () => {
  // Cascade-delete via org (comments, tasks, roles, memberships)
  if (orgId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  }
  // Users are not cascade-deleted with the org
  const userIds = [ownerUserId, memberUserId, adminUserId, customUserId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

// ---------------------------------------------------------------------------
// Permission gate: Member (delete_comments: false) is blocked
// ---------------------------------------------------------------------------
describeIf(
  "delete_comments gate — Member (delete_comments: false) cannot moderate comments",
  () => {
    it("returns 403 when a member tries to delete another user's comment", async () => {
      // Seed a comment authored by the owner — not the requesting member
      const commentId = await seedComment(ownerUserId, "Owner's comment");

      // Act as member with delete_comments: false
      ctx.userId = memberUserId;
      ctx.permissions = { ...MEMBER_PERMISSIONS };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(403);

      // Row must not have been soft-deleted
      const [row] = await db
        .select({ id: commentsTable.id, deletedAt: commentsTable.deletedAt })
        .from(commentsTable)
        .where(eq(commentsTable.id, commentId));
      expect(row).toBeDefined();
      expect(row.deletedAt).toBeNull();
    });

    it("returns 403 even if the comment has no userId (legacy comment)", async () => {
      // Legacy comments have userId = null — member cannot claim ownership
      const commentId = await seedComment(null, "Legacy comment");

      ctx.userId = memberUserId;
      ctx.permissions = { ...MEMBER_PERMISSIONS };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(403);

      const [row] = await db
        .select({ deletedAt: commentsTable.deletedAt })
        .from(commentsTable)
        .where(eq(commentsTable.id, commentId));
      expect(row?.deletedAt).toBeNull();
    });
  },
);

// ---------------------------------------------------------------------------
// Permission gate: Admin (delete_comments: true) can moderate any comment
// ---------------------------------------------------------------------------
describeIf(
  "delete_comments gate — Admin (delete_comments: true) can moderate comments",
  () => {
    it("returns 204 when an admin deletes another user's comment", async () => {
      const commentId = await seedComment(memberUserId, "Member's comment — admin will delete");

      // Act as admin with delete_comments: true
      ctx.userId = adminUserId;
      ctx.permissions = { ...ADMIN_PERMISSIONS };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(204);
    });

    it("soft-deletes the row in the DB (deletedAt is stamped, content preserved)", async () => {
      const content = "Comment to be soft-deleted by admin";
      const commentId = await seedComment(memberUserId, content);

      ctx.userId = adminUserId;
      ctx.permissions = { ...ADMIN_PERMISSIONS };

      await request(buildApp()).delete(`/api/comments/${commentId}`);

      // The row must still exist with deletedAt set
      const [row] = await db
        .select({ id: commentsTable.id, deletedAt: commentsTable.deletedAt, content: commentsTable.content })
        .from(commentsTable)
        .where(eq(commentsTable.id, commentId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      // Physical content is preserved on the row (tombstone display is a UI concern)
      expect(row.content).toBe(content);
    });

    it("returns 204 when an admin deletes a legacy comment (userId null)", async () => {
      const commentId = await seedComment(null, "Legacy comment — admin can delete");

      ctx.userId = adminUserId;
      ctx.permissions = { ...ADMIN_PERMISSIONS };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(204);
    });
  },
);

// ---------------------------------------------------------------------------
// Comment owner can always delete their own comment (regardless of permission)
// ---------------------------------------------------------------------------
describeIf(
  "delete_comments gate — comment owner can delete their own comment",
  () => {
    it("returns 204 when a member deletes their own comment even without delete_comments", async () => {
      // Comment is authored by memberUserId; requester is also memberUserId
      const commentId = await seedComment(memberUserId, "Member's own comment");

      ctx.userId = memberUserId;
      ctx.permissions = { ...MEMBER_PERMISSIONS }; // delete_comments: false

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(204);
    });
  },
);

// ---------------------------------------------------------------------------
// Custom role: revoking delete_comments blocks comment moderation
// ---------------------------------------------------------------------------
describeIf(
  "delete_comments gate — revoking delete_comments from a custom role removes moderation access",
  () => {
    it("returns 204 when the custom role has delete_comments: true", async () => {
      const commentId = await seedComment(ownerUserId, "Comment — custom moderator will delete");

      // Moderator role currently has delete_comments: true (set in beforeAll)
      ctx.userId = customUserId;
      ctx.permissions = { ...MEMBER_PERMISSIONS, delete_comments: true };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(204);
    });

    it("returns 403 after delete_comments is revoked from the custom role in the DB", async () => {
      // Revoke delete_comments on the Moderator role in the DB
      await db
        .update(rolesTable)
        .set({ permissions: { ...MEMBER_PERMISSIONS, delete_comments: false } })
        .where(eq(rolesTable.id, customRoleId));

      const commentId = await seedComment(ownerUserId, "Comment — ex-moderator is now blocked");

      // Middleware simulates what the real middleware would read from the updated role
      ctx.userId = customUserId;
      ctx.permissions = { ...MEMBER_PERMISSIONS, delete_comments: false };

      const res = await request(buildApp()).delete(`/api/comments/${commentId}`);

      expect(res.status).toBe(403);

      // Comment row must not be soft-deleted
      const [row] = await db
        .select({ deletedAt: commentsTable.deletedAt })
        .from(commentsTable)
        .where(eq(commentsTable.id, commentId));
      expect(row?.deletedAt).toBeNull();
    });

    it("confirms the revoked role row in the DB actually has delete_comments: false", async () => {
      const [role] = await db
        .select({ permissions: rolesTable.permissions })
        .from(rolesTable)
        .where(eq(rolesTable.id, customRoleId));
      expect(role).toBeDefined();
      expect((role.permissions as Record<string, boolean>).delete_comments).toBe(false);
    });
  },
);

// ---------------------------------------------------------------------------
// 404 on already-soft-deleted comment (idempotency guard)
// ---------------------------------------------------------------------------
describeIf(
  "delete_comments gate — already-deleted comment returns 404",
  () => {
    it("returns 404 when an admin tries to delete an already soft-deleted comment", async () => {
      const commentId = await seedComment(memberUserId, "Comment to be deleted twice");

      ctx.userId = adminUserId;
      ctx.permissions = { ...ADMIN_PERMISSIONS };

      // First delete — should succeed
      const first = await request(buildApp()).delete(`/api/comments/${commentId}`);
      expect(first.status).toBe(204);

      // Second delete on the same id — should 404 (row is now soft-deleted)
      const second = await request(buildApp()).delete(`/api/comments/${commentId}`);
      expect(second.status).toBe(404);
    });
  },
);
