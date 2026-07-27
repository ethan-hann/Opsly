/**
 * Tests confirming that logOrgEvent is called with the correct payload for
 * the five highest-risk org audit events:
 *
 *  - member.invited       (POST /orgs/invite)
 *  - member.role_changed  (PATCH /orgs/members/:userId/role)
 *  - project.deleted      (DELETE /projects/:id)
 *  - role.created         (POST /roles)
 *  - workflow.stage_deleted (DELETE /workflow-stages/:id)
 *
 * logOrgEvent is spied on directly so tests don't depend on DB insert
 * introspection — the spy captures the exact payload each route passes.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Spy on logOrgEvent — hoisted so the vi.mock factory can reference it
// ---------------------------------------------------------------------------
const logOrgEventSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../lib/log-org-event", () => ({
  logOrgEvent: logOrgEventSpy,
}));

// ---------------------------------------------------------------------------
// Shared mock state — consumed in FIFO order by each db.select() call
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],   // next insert().values().returning() result
  updateResult: [] as any[],   // next update...returning() result
  deleteResult: [] as any[],   // next delete...returning() result
  /** Full permissions map — all keys true by default (owner/admin level). */
  permissions: {} as Record<string, boolean>,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db — covers all five routers
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  const dbMock: any = {
    select: () => makeChain(mockState.selectQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockState.insertResult),
        then(onfulfilled: any, onrejected: any) {
          return Promise.resolve(undefined).then(onfulfilled, onrejected);
        },
        catch(onrejected: any) {
          return Promise.resolve(undefined).catch(onrejected);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.updateResult),
          then(onfulfilled: any, onrejected: any) {
            return Promise.resolve(undefined).then(onfulfilled, onrejected);
          },
          catch(onrejected: any) {
            return Promise.resolve(undefined).catch(onrejected);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(mockState.deleteResult),
        then(onfulfilled: any, onrejected: any) {
          return Promise.resolve(undefined).then(onfulfilled, onrejected);
        },
        catch(onrejected: any) {
          return Promise.resolve(undefined).catch(onrejected);
        },
      }),
    }),
    transaction: async (fn: any) => fn(dbMock),
  };

  const ALL_PERMS: Record<string, boolean> = {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true,
    manage_sla_policies: true, manage_task_templates: true,
    manage_saved_views: true, view_audit_log: true,
  };

  return {
    db: dbMock,
    // Tables — only need to exist as objects (used as query DSL references)
    organizationsTable: {},
    orgMembersTable: {},
    rolesTable: {},
    invitationsTable: {},
    usersTable: {},
    projectsTable: {},
    tasksTable: {},
    workflowStagesTable: {},
    orgEventsTable: {},
    orgTerminologyTable: {},
    orgFeaturesTable: {},
    slaPoliciesTable: {},
    projectSlaPolicyAuditTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    // Constants used by route files
    OWNER_PERMISSIONS: ALL_PERMS,
    ADMIN_PERMISSIONS: ALL_PERMS,
    MEMBER_PERMISSIONS: { view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true },
    ALL_PERMISSIONS: Object.keys(ALL_PERMS),
    TERMINOLOGY_KEYS: ["projects", "tasks", "members", "workflows", "stages"],
    TERMINOLOGY_DEFAULTS: { projects: "Projects", tasks: "Tasks", members: "Members", workflows: "Workflows", stages: "Stages" },
    SINGULAR_TERMINOLOGY_KEYS: [],
    ORG_FEATURES: ["webhooks", "api_keys", "data_export", "custom_fields", "custom_statuses", "sla_tracking"],
    sql: (...args: any[]) => args,
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    isNull: () => ({}),
    isNotNull: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: (...args: any[]) => args,
  or: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  gt: () => ({}),
  ne: () => ({}),
  not: () => ({}),
  inArray: () => ({}),
  notInArray: () => ({}),
  ilike: () => ({}),
}));

// Stub helpers that trigger side effects or external I/O
vi.mock("../lib/email", () => ({
  sendMail: async () => ({ ok: true }),
  buildInviteEmail: () => "<html/>",
  isEmailConfigured: () => false,
}));

// Resilient mock: spread the real module so new exports never break this mock,
// then stub only the side-effecting emitters (so handlers stay inert / assertable).
vi.mock("../lib/sse", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sse")>()),
  pushEvent: vi.fn(),
  broadcastToOrg: vi.fn(),
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchMemberJoined: vi.fn(),
  dispatchMemberRemoved: vi.fn(),
  dispatchProjectCreated: vi.fn(),
  dispatchProjectUpdated: vi.fn(),
  dispatchProjectDeleted: vi.fn(),
}));

vi.mock("../lib/workflow-stages", () => ({
  getOrSeedStages: async () => [],
  seedDefaultStages: async () => undefined,
}));

vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  getOrgFeatureStates: async () => ({}),
  isOrgFeatureEnabled: async () => true,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Import routers AFTER mocks are registered
// ---------------------------------------------------------------------------
import orgsRouter from "./orgs.js";
import rolesRouter from "./roles.js";
import projectsRouter from "./projects.js";
import workflowStagesRouter from "./workflow-stages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full permission map used for owner/admin-level callers. */
const ALL_PERMS: Record<string, boolean> = {
  view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
  delete_tasks: true, manage_projects: true, manage_org_settings: true,
  manage_members: true, manage_webhooks: true, manage_api_keys: true,
  manage_custom_fields: true, manage_workflow_stages: true,
  manage_sla_policies: true, manage_task_templates: true,
  manage_saved_views: true, view_audit_log: true,
};

/** Membership row consumed by requireOrg / requireOrgOrApiKey. */
function membershipRow(isOwner = true) {
  return {
    orgId: "test-org",
    roleId: "role-owner",
    roleName: isOwner ? "Owner" : "Admin",
    isOwner,
    permissions: ALL_PERMS,
    isDisabled: false,
  };
}

/** Build a minimal Express app that injects a session user before the given router. */
function buildApp(...routers: any[]) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = {
      id: "user-actor",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
    };
    next();
  });
  for (const router of routers) {
    app.use("/api", router);
  }
  return app;
}

/** Flush all queued microtasks so fire-and-forget logOrgEvent calls settle. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Org audit events — logOrgEvent payload assertions", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    logOrgEventSpy.mockClear();
  });

  // ── member.invited ─────────────────────────────────────────────────────────

  it("member.invited: POST /orgs/invite writes correct action and targetName", async () => {
    // 1. requireOrg membership select
    mockState.selectQueue.push([membershipRow()]);
    // 2. INSERT invitation returning
    mockState.insertResult = [{
      id: "inv-1",
      orgId: "test-org",
      invitedEmail: "bob@example.com",
      invitedUserId: null,
      token: "tok123",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    }];

    const res = await request(buildApp(orgsRouter))
      .post("/api/orgs/invite")
      .send({ email: "bob@example.com" });

    await tick(); // let the void logOrgEvent() settle

    expect(res.status).toBe(201);
    expect(logOrgEventSpy).toHaveBeenCalledOnce();

    const payload = logOrgEventSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe("member.invited");
    expect(payload.category).toBe("member");
    expect(payload.actorId).toBe("user-actor");
    expect(payload.targetName).toBe("bob@example.com");
  });

  // ── role.created ───────────────────────────────────────────────────────────

  it("role.created: POST /roles writes correct action and targetName", async () => {
    // 1. requireOrg membership select (isOwner=true for requireOwner)
    mockState.selectQueue.push([membershipRow(true)]);
    // 2. SELECT existing role by name → none (no conflict)
    mockState.selectQueue.push([]);
    // 3. INSERT role returning
    mockState.insertResult = [{
      id: "role-new",
      orgId: "test-org",
      name: "Reviewer",
      isBuiltIn: false,
      isOwner: false,
      permissions: ALL_PERMS,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const res = await request(buildApp(rolesRouter))
      .post("/api/roles")
      .send({ name: "Reviewer" });

    await tick();

    expect(res.status).toBe(201);
    expect(logOrgEventSpy).toHaveBeenCalledOnce();

    const payload = logOrgEventSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe("role.created");
    expect(payload.category).toBe("role");
    expect(payload.actorId).toBe("user-actor");
    expect(payload.targetName).toBe("Reviewer");
  });

  // ── project.deleted ────────────────────────────────────────────────────────

  it("project.deleted: DELETE /projects/:id writes correct action and targetName", async () => {
    // 1. requireOrgOrApiKey membership select (session path)
    mockState.selectQueue.push([membershipRow()]);
    // 2. DELETE project returning
    mockState.deleteResult = [{ id: 7, orgId: "test-org", name: "Alpha Project" }];

    const res = await request(buildApp(projectsRouter))
      .delete("/api/projects/7");

    await tick();

    expect(res.status).toBe(204);
    expect(logOrgEventSpy).toHaveBeenCalledOnce();

    const payload = logOrgEventSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe("project.deleted");
    expect(payload.category).toBe("project");
    expect(payload.actorId).toBe("user-actor");
    expect(payload.targetName).toBe("Alpha Project");
  });

  // ── member.role_changed ────────────────────────────────────────────────────

  it("member.role_changed: PATCH /orgs/members/:userId/role writes correct action and targetId", async () => {
    // 1. requireOrg membership select
    mockState.selectQueue.push([membershipRow(true)]);
    // 2. SELECT target member (join with role): not currently an owner
    mockState.selectQueue.push([{ roleId: "role-member", currentRoleIsOwner: false }]);
    // 3. SELECT target role by id: non-owner role
    mockState.selectQueue.push([{
      id: "role-admin",
      orgId: "test-org",
      name: "Admin",
      isBuiltIn: true,
      isOwner: false,
      permissions: ALL_PERMS,
    }]);
    // 4. db.transaction → UPDATE member returning
    mockState.updateResult = [{
      userId: "user-target",
      roleId: "role-admin",
      orgId: "test-org",
      joinedAt: new Date(),
    }];
    // 5. SELECT userInfo for targetName
    mockState.selectQueue.push([{
      firstName: "Bob",
      lastName: null,
      email: "bob@example.com",
      profileImageUrl: null,
    }]);

    const res = await request(buildApp(orgsRouter))
      .patch("/api/orgs/members/user-target/role")
      .send({ roleId: "role-admin" });

    await tick();

    expect(res.status).toBe(200);
    expect(logOrgEventSpy).toHaveBeenCalledOnce();

    const payload = logOrgEventSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe("member.role_changed");
    expect(payload.category).toBe("member");
    expect(payload.actorId).toBe("user-actor");
    expect(payload.targetId).toBe("user-target");
    // targetName resolves from userInfo: "Bob" (firstName only, no lastName)
    expect(payload.targetName).toBe("Bob");
  });

  // ── workflow.stage_deleted ─────────────────────────────────────────────────

  it("workflow.stage_deleted: DELETE /workflow-stages/:id writes correct action and targetName", async () => {
    // 1. requireOrg membership select
    mockState.selectQueue.push([membershipRow()]);
    // 2. SELECT stage by id
    mockState.selectQueue.push([{
      id: 3,
      orgId: "test-org",
      name: "In Review",
      type: "in_progress",
      color: "#aaa",
      position: 2,
      archivedAt: null,
    }]);
    // 3. SELECT other active stages of same type (must have ≥ 1 to allow deletion)
    mockState.selectQueue.push([
      { type: "in_progress", id: 99 }, // another active in_progress stage → deletion allowed
    ]);
    // 4. SELECT task count using this stage → 0 (no reassignment needed)
    mockState.selectQueue.push([{ count: 0 }]);
    // DELETE stage — mockState.deleteResult unused here (no .returning())

    const res = await request(buildApp(workflowStagesRouter))
      .delete("/api/workflow-stages/3");

    await tick();

    expect(res.status).toBe(204);
    expect(logOrgEventSpy).toHaveBeenCalledOnce();

    const payload = logOrgEventSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe("workflow.stage_deleted");
    expect(payload.category).toBe("workflow");
    expect(payload.actorId).toBe("user-actor");
    expect(payload.targetName).toBe("In Review");
  });
});
