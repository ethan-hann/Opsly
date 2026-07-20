/**
 * Live-database org isolation integration tests.
 *
 * These tests require a real DATABASE_URL and a live PostgreSQL connection.
 * They seed two real organizations (Org A and Org B) in the test database,
 * then run every list/by-id endpoint as Org A and assert that no Org B data
 * leaks through — catching query-level bugs that the mock-based isolation
 * suite (isolation.test.ts) cannot detect.
 *
 * The suite skips automatically when DATABASE_URL is not set.
 *
 * Covered endpoints:
 *  - GET  /api/tasks             — list returns only Org A tasks
 *  - GET  /api/tasks/:id         — 404 for Org B task id
 *  - GET  /api/tasks/overdue     — overdue list unaffected by Org B
 *  - GET  /api/projects          — list returns only Org A projects
 *  - GET  /api/projects/:id      — 404 for Org B project id
 *  - GET  /api/tasks/:id/comments — 404 when parent task is in Org B
 *  - DELETE /api/comments/:id    — 404 for Org B comment
 *  - GET  /api/notes             — list returns only Org A notes
 *  - GET  /api/notes/:id         — 404 for Org B note id
 *  - GET  /api/dashboard/summary — counters reflect only Org A data
 *  - GET  /api/dashboard/activity — activity reflects only Org A data
 *  - GET  /api/orgs/members      — only Org A members returned
 *  - GET  /api/orgs/invitations  — only Org A invitations returned
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Skip the whole suite when DATABASE_URL is not set
// ---------------------------------------------------------------------------
const describeIf = process.env.DATABASE_URL
  ? describe
  : describe.skip;

// ---------------------------------------------------------------------------
// Mutable state shared with the middleware mock — populated in beforeAll
// ---------------------------------------------------------------------------
const orgAState = vi.hoisted(() => ({ orgId: "" }));

// ---------------------------------------------------------------------------
// Mock ONLY the auth/org middleware — the real DB is used for every query
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => {
  const ALL_PERMS = {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
    manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
  };
  return {
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
    requireOrg: (req: any, _res: any, next: any) => {
      req.orgId = orgAState.orgId;
      req.orgRole = "admin";
      req.orgRoleId = "test-owner-role";
      req.orgRoleName = "Owner";
      req.isOrgOwner = true;
      req.orgPermissions = ALL_PERMS;
      req.user = { id: "test-user-a", email: "test-user-a@integration.local" };
      next();
    },
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: "test-user-a", email: "test-user-a@integration.local" };
      next();
    },
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    requireOwner: (_req: any, _res: any, next: any) => next(),
    requirePermission: (_key: string) => (_req: any, _res: any, next: any) => next(),
    requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
      req.orgId = orgAState.orgId;
      req.orgRole = "admin";
      req.orgRoleId = "test-owner-role";
      req.orgRoleName = "Owner";
      req.isOrgOwner = true;
      req.orgPermissions = ALL_PERMS;
      req.user = { id: "test-user-a", email: "test-user-a@integration.local" };
      next();
    },
  };
});

// ---------------------------------------------------------------------------
// @workspace/api-zod — passthrough so we don't need generated output in tests
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
    CreateTaskBody: p, UpdateTaskBody: p,
    GetTaskParams: p, UpdateTaskParams: p, DeleteTaskParams: p,
    ListTasksQueryParams: p,
    ListTasksResponse: p, CreateTaskResponse: p, GetTaskResponse: p,
    UpdateTaskResponse: p, GetOverdueTasksResponse: p,
    BulkUpdateTasksBody: p, BulkUpdateTasksResponse: p,
    BulkDeleteTasksBody: p, BulkDeleteTasksResponse: p,
    ListTaskEventsParams: p, ListTaskEventsResponse: p,
    // task watchers
    WatchingFilterParam: p, WatchTaskParams: p, UnwatchTaskParams: p,
    GetTaskWatchersParams: p, GetTaskWatchersResponse: p,
    WatchTaskResponse: p, UnwatchTaskResponse: p,
    CreateProjectBody: p, UpdateProjectBody: p,
    GetProjectParams: p, UpdateProjectParams: p, DeleteProjectParams: p,
    ListProjectsResponse: p, CreateProjectResponse: p,
    GetProjectResponse: p, UpdateProjectResponse: p,
    CreateCommentBody: p, CreateCommentParams: p,
    ListCommentsParams: p, DeleteCommentParams: p,
    ListCommentsResponse: p, CreateCommentResponse: p, DeleteCommentResponse: p,
    ListNotesQueryParams: p, ListNotesResponse: p,
    CreateNoteBody: p, CreateNoteResponse: p,
    GetNoteParams: p, GetNoteResponse: p,
    UpdateNoteParams: p, UpdateNoteBody: p, UpdateNoteResponse: p,
    DeleteNoteParams: p,
    GetDashboardSummaryResponse: p, GetRecentActivityResponse: p,
  };
});

// Stub side-effect modules that open connections or spawn timers
vi.mock("../lib/notes-sse", () => ({
  addSseClient: () => () => {},
  broadcastNoteChange: () => {},
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
  dispatchTaskCommented: () => {},
  dispatchProjectCreated: () => {},
  dispatchProjectUpdated: () => {},
}));

// ---------------------------------------------------------------------------
// Import real routes AFTER mocks are in place
// ---------------------------------------------------------------------------
import tasksRouter from "./tasks.js";
import projectsRouter from "./projects.js";
import commentsRouter from "./comments.js";
import notesRouter from "./notes.js";
import dashboardRouter from "./dashboard.js";
import orgsRouter from "./orgs.js";

// Real DB imports — not mocked, use the live database
import {
  db,
  organizationsTable,
  rolesTable,
  orgMembersTable,
  usersTable,
  invitationsTable,
  projectsTable,
  tasksTable,
  commentsTable,
  notesTable,
  workflowStagesTable,
  OWNER_PERMISSIONS,
  MEMBER_PERMISSIONS,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  app.use("/api", projectsRouter);
  app.use("/api", commentsRouter);
  app.use("/api", notesRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", orgsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[test app error]", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Seed state — IDs recorded so tests and cleanup can reference them
// ---------------------------------------------------------------------------
let orgAId: string;
let orgBId: string;
let orgATaskId: number;
let orgBTaskId: number;
let orgAProjectId: number;
let orgBProjectId: number;
let orgACommentId: number;
let orgBCommentId: number;
let orgANoteId: number;
let orgBNoteId: number;
let orgAUserId: string;
let orgBUserId: string;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Create a temporary test user row (email uniqueness enforced by DB). */
async function createTestUser(suffix: string): Promise<string> {
  const email = `integration-test-${suffix}-${Date.now()}@test.local`;
  const [user] = await db
    .insert(usersTable)
    .values({ email, firstName: "Test", lastName: suffix })
    .returning({ id: usersTable.id });
  return user.id;
}

/** Seed built-in Owner + Member roles for an org; return Owner role id. */
async function seedRoles(orgId: string): Promise<string> {
  const [ownerRole] = await db
    .insert(rolesTable)
    .values({ orgId, name: "Owner", isBuiltIn: true, isOwner: true, permissions: OWNER_PERMISSIONS })
    .returning({ id: rolesTable.id });
  await db
    .insert(rolesTable)
    .values({ orgId, name: "Member", isBuiltIn: true, isOwner: false, permissions: MEMBER_PERMISSIONS });
  return ownerRole.id;
}

/**
 * Seed default workflow stages for an org; return the "To Do" stage id as a
 * string so it can be used directly as task.status in test inserts.
 */
async function seedStages(orgId: string): Promise<string> {
  const stages = await db
    .insert(workflowStagesTable)
    .values([
      { orgId, name: "To Do",       color: "#6b7280", type: "open",   position: 0 },
      { orgId, name: "In Progress", color: "#f59e0b", type: "open",   position: 1 },
      { orgId, name: "Blocked",     color: "#ef4444", type: "open",   position: 2 },
      { orgId, name: "Done",        color: "#10b981", type: "closed", position: 3 },
    ])
    .returning({ id: workflowStagesTable.id });
  // Return the "To Do" stage id as a string (task.status is text)
  return String(stages[0].id);
}

// ---------------------------------------------------------------------------
// Seed two orgs before any test runs
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Create users
  orgAUserId = await createTestUser("user-a");
  orgBUserId = await createTestUser("user-b");

  // Create Org A
  const [orgA] = await db
    .insert(organizationsTable)
    .values({ name: "Integration Test Org A" })
    .returning({ id: organizationsTable.id });
  orgAId = orgA.id;

  // Create Org B
  const [orgB] = await db
    .insert(organizationsTable)
    .values({ name: "Integration Test Org B" })
    .returning({ id: organizationsTable.id });
  orgBId = orgB.id;

  // Seed roles and memberships
  const ownerRoleAId = await seedRoles(orgAId);
  const ownerRoleBId = await seedRoles(orgBId);

  await db.insert(orgMembersTable).values({ orgId: orgAId, userId: orgAUserId, roleId: ownerRoleAId });
  await db.insert(orgMembersTable).values({ orgId: orgBId, userId: orgBUserId, roleId: ownerRoleBId });

  // Seed default workflow stages for both orgs and capture the "To Do" stage
  // id so tasks can reference it as a valid numeric status value.
  const orgAToDoStageId = await seedStages(orgAId);
  const orgBToDoStageId = await seedStages(orgBId);

  // Seed projects for both orgs
  const [projA] = await db
    .insert(projectsTable)
    .values({ orgId: orgAId, name: "Org A Project", status: "active", priority: "medium" })
    .returning({ id: projectsTable.id });
  orgAProjectId = projA.id;

  const [projB] = await db
    .insert(projectsTable)
    .values({ orgId: orgBId, name: "Org B Secret Project", status: "active", priority: "medium" })
    .returning({ id: projectsTable.id });
  orgBProjectId = projB.id;

  // Seed tasks for both orgs — status must be a valid stage id (numeric string)
  const [taskA] = await db
    .insert(tasksTable)
    .values({
      orgId: orgAId,
      orgTaskNumber: 1,
      title: "Org A Task",
      status: orgAToDoStageId,
      priority: "medium",
      category: "other",
    })
    .returning({ id: tasksTable.id });
  orgATaskId = taskA.id;

  const [taskB] = await db
    .insert(tasksTable)
    .values({
      orgId: orgBId,
      orgTaskNumber: 1,
      title: "Org B Secret Task",
      status: orgBToDoStageId,
      priority: "medium",
      category: "other",
    })
    .returning({ id: tasksTable.id });
  orgBTaskId = taskB.id;

  // Seed comments for both orgs
  const [commentA] = await db
    .insert(commentsTable)
    .values({ orgId: orgAId, taskId: orgATaskId, content: "Org A comment", author: "user-a" })
    .returning({ id: commentsTable.id });
  orgACommentId = commentA.id;

  const [commentB] = await db
    .insert(commentsTable)
    .values({ orgId: orgBId, taskId: orgBTaskId, content: "Org B secret comment", author: "user-b" })
    .returning({ id: commentsTable.id });
  orgBCommentId = commentB.id;

  // Seed notes for both orgs
  const [noteA] = await db
    .insert(notesTable)
    .values({ orgId: orgAId, title: "Org A Note", content: "org a content", visibility: "public_read", createdBy: orgAUserId })
    .returning({ id: notesTable.id });
  orgANoteId = noteA.id;

  const [noteB] = await db
    .insert(notesTable)
    .values({ orgId: orgBId, title: "Org B Secret Note", content: "secret", visibility: "public_read", createdBy: orgBUserId })
    .returning({ id: notesTable.id });
  orgBNoteId = noteB.id;

  // Seed invitations for Org B (so we can assert they don't appear in Org A)
  await db.insert(invitationsTable).values({
    orgId: orgBId,
    invitedEmail: "secret-invite@org-b.local",
    invitedById: orgBUserId,
    token: `test-token-b-${Date.now()}`,
    status: "pending",
    expiresAt: new Date(Date.now() + 86400_000),
  });

  // Point the middleware at Org A
  orgAState.orgId = orgAId;
});

// ---------------------------------------------------------------------------
// Remove all seeded data after the suite completes
// ---------------------------------------------------------------------------
afterAll(async () => {
  // Delete in FK order; cascades handle child rows automatically.
  // Notes / comments / tasks / projects / members / roles are all cascade-deleted
  // when the org is deleted, but invitations reference users so delete those first.
  if (orgAId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgAId));
  }
  if (orgBId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgBId));
  }
  // Clean up users (no cascade from org deletion back to users)
  const userIds = [orgAUserId, orgBUserId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf("DB isolation — GET /api/tasks (list)", () => {
  it("returns only Org A tasks, not Org B tasks", async () => {
    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    const ids = res.body.map((t: any) => t.id);
    expect(ids).toContain(orgATaskId);
    expect(ids).not.toContain(orgBTaskId);
  });

  it("every returned task has orgId === Org A", async () => {
    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    for (const task of res.body) {
      expect(task.orgId).toBe(orgAId);
    }
  });
});

describeIf("DB isolation — GET /api/tasks/:id", () => {
  it("returns 200 for Org A task", async () => {
    const res = await request(buildApp()).get(`/api/tasks/${orgATaskId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgATaskId);
    expect(res.body.orgId).toBe(orgAId);
  });

  it("returns 404 for Org B task id (cross-org leak blocked)", async () => {
    const res = await request(buildApp()).get(`/api/tasks/${orgBTaskId}`);
    expect(res.status).toBe(404);
  });
});

describeIf("DB isolation — GET /api/tasks/overdue", () => {
  it("does not include Org B overdue tasks in the response", async () => {
    // Plant an overdue task in Org B
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split("T")[0];
    const [overdueB] = await db
      .insert(tasksTable)
      .values({
        orgId: orgBId,
        orgTaskNumber: 99,
        title: "Org B overdue task",
        status: "todo",
        priority: "high",
        category: "other",
        dueDate: yesterday,
      })
      .returning({ id: tasksTable.id });

    try {
      const res = await request(buildApp()).get("/api/tasks/overdue");
      expect(res.status).toBe(200);
      const ids = res.body.map((t: any) => t.id);
      expect(ids).not.toContain(overdueB.id);
    } finally {
      await db.delete(tasksTable).where(eq(tasksTable.id, overdueB.id));
    }
  });
});

describeIf("DB isolation — GET /api/projects (list)", () => {
  it("returns only Org A projects, not Org B projects", async () => {
    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.id);
    expect(ids).toContain(orgAProjectId);
    expect(ids).not.toContain(orgBProjectId);
  });

  it("every returned project has orgId === Org A", async () => {
    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    for (const project of res.body) {
      expect(project.orgId).toBe(orgAId);
    }
  });
});

describeIf("DB isolation — GET /api/projects/:id", () => {
  it("returns 200 for Org A project", async () => {
    const res = await request(buildApp()).get(`/api/projects/${orgAProjectId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgAProjectId);
  });

  it("returns 404 for Org B project id (cross-org leak blocked)", async () => {
    const res = await request(buildApp()).get(`/api/projects/${orgBProjectId}`);
    expect(res.status).toBe(404);
  });
});

describeIf("DB isolation — GET /api/tasks/:id/comments", () => {
  it("returns 200 and Org A comments for an Org A task", async () => {
    const res = await request(buildApp()).get(`/api/tasks/${orgATaskId}/comments`);
    expect(res.status).toBe(200);
    const ids = res.body.map((c: any) => c.id);
    expect(ids).toContain(orgACommentId);
    expect(ids).not.toContain(orgBCommentId);
  });

  it("returns 404 when the task id belongs to Org B", async () => {
    const res = await request(buildApp()).get(`/api/tasks/${orgBTaskId}/comments`);
    expect(res.status).toBe(404);
  });
});

describeIf("DB isolation — DELETE /api/comments/:id", () => {
  it("returns 404 when trying to delete an Org B comment", async () => {
    const res = await request(buildApp()).delete(`/api/comments/${orgBCommentId}`);
    expect(res.status).toBe(404);
    // Verify it was not actually deleted
    const [still] = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.id, orgBCommentId));
    expect(still).toBeDefined();
  });
});

describeIf("DB isolation — GET /api/notes (list)", () => {
  it("returns only Org A notes, not Org B notes", async () => {
    const res = await request(buildApp()).get("/api/notes");
    expect(res.status).toBe(200);
    const ids = res.body.map((n: any) => n.id);
    expect(ids).toContain(orgANoteId);
    expect(ids).not.toContain(orgBNoteId);
  });
});

describeIf("DB isolation — GET /api/notes/:id", () => {
  it("returns 200 for Org A note", async () => {
    const res = await request(buildApp()).get(`/api/notes/${orgANoteId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orgANoteId);
  });

  it("returns 404 for Org B note id (cross-org leak blocked)", async () => {
    const res = await request(buildApp()).get(`/api/notes/${orgBNoteId}`);
    expect(res.status).toBe(404);
  });
});

describeIf("DB isolation — GET /api/dashboard/summary", () => {
  it("summary counters reflect only Org A data", async () => {
    const res = await request(buildApp()).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    const { totalTasks, totalProjects } = res.body;
    // We seeded exactly 1 task and 1 project in Org A
    expect(totalTasks).toBeGreaterThanOrEqual(1);
    expect(totalProjects).toBeGreaterThanOrEqual(1);
  });

  it("Org B task count does not inflate Org A totalTasks", async () => {
    // Fetch before/after inserting an extra Org B task
    const before = await request(buildApp()).get("/api/dashboard/summary");
    const beforeTotal: number = before.body.totalTasks;

    // Fetch Org B's "To Do" stage id so the extra task has a valid status
    const [orgBStage] = await db
      .select({ id: workflowStagesTable.id })
      .from(workflowStagesTable)
      .where(eq(workflowStagesTable.orgId, orgBId))
      .limit(1);
    const [extraB] = await db
      .insert(tasksTable)
      .values({ orgId: orgBId, orgTaskNumber: 2, title: "Extra Org B task", status: String(orgBStage.id), priority: "low", category: "other" })
      .returning({ id: tasksTable.id });

    try {
      const after = await request(buildApp()).get("/api/dashboard/summary");
      expect(after.status).toBe(200);
      // Org A counter must not have changed
      expect(after.body.totalTasks).toBe(beforeTotal);
    } finally {
      await db.delete(tasksTable).where(eq(tasksTable.id, extraB.id));
    }
  });
});

describeIf("DB isolation — GET /api/dashboard/activity", () => {
  it("activity items do not include Org B task or project titles", async () => {
    const res = await request(buildApp()).get("/api/dashboard/activity");
    expect(res.status).toBe(200);
    const titles: string[] = res.body.map((item: any) => item.title ?? "");
    const hasOrgBLeak = titles.some(
      (t) => t.includes("Org B Secret Task") || t.includes("Org B Secret Project"),
    );
    expect(hasOrgBLeak).toBe(false);
  });
});

describeIf("DB isolation — GET /api/orgs/members", () => {
  it("returns only Org A members", async () => {
    const res = await request(buildApp()).get("/api/orgs/members");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Org B user should not appear in Org A member list
    const memberUserIds = res.body.map((m: any) => m.userId ?? m.id);
    expect(memberUserIds).not.toContain(orgBUserId);
  });
});

describeIf("DB isolation — GET /api/orgs/invitations", () => {
  it("returns only Org A invitations (Org B invitation not visible)", async () => {
    // Seed an Org A invitation for comparison
    const [invA] = await db
      .insert(invitationsTable)
      .values({
        orgId: orgAId,
        invitedEmail: "invite-a@test.local",
        invitedById: orgAUserId,
        token: `test-token-a-${Date.now()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400_000),
      })
      .returning({ id: invitationsTable.id });

    try {
      const res = await request(buildApp()).get("/api/orgs/invitations");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const invOrgIds = res.body.map((inv: any) => inv.orgId);
      // Every invitation in the response must belong to Org A
      for (const orgId of invOrgIds) {
        expect(orgId).toBe(orgAId);
      }
    } finally {
      await db.delete(invitationsTable).where(eq(invitationsTable.id, invA.id));
    }
  });
});

describeIf("DB isolation — PATCH /api/tasks/bulk (cross-org mutation guard)", () => {
  it("returns updated: 0 and leaves Org B task untouched when IDs belong to Org B", async () => {
    // Org A caller submits Org B's task ID. The handler scopes the prevRows
    // fetch to orgId=OrgA, finds nothing, and returns updated:0 without touching
    // any row.
    const res = await request(buildApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [orgBTaskId], patch: { priority: "low" } });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);

    // Verify Org B task still exists with its original priority
    const [still] = await db
      .select({ id: tasksTable.id, priority: tasksTable.priority })
      .from(tasksTable)
      .where(eq(tasksTable.id, orgBTaskId));
    expect(still).toBeDefined();
    expect(still.priority).toBe("medium"); // unchanged from seed
  });
});

describeIf("DB isolation — DELETE /api/tasks/bulk (cross-org deletion guard)", () => {
  it("returns deleted: 0 and leaves Org B task untouched when IDs belong to Org B", async () => {
    // Org A caller submits Org B's task ID. The handler scopes the candidate
    // fetch to orgId=OrgA, finds nothing, and returns deleted:0 without removing
    // any row.
    const res = await request(buildApp())
      .delete("/api/tasks/bulk")
      .send({ ids: [orgBTaskId] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);

    // Verify Org B task was not deleted
    const [still] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.id, orgBTaskId));
    expect(still).toBeDefined();
  });
});
