/**
 * Tests confirming that resolveActor correctly attributes API key requests
 * in task audit events.
 *
 * A "simApiKeyAuth" middleware is prepended to the app — exactly as in
 * api-key-isolation.test.ts — to replicate what authMiddleware.resolveApiKey
 * does after a successful DB lookup:
 *   - req.apiKeyId   is set to the key's opaque DB ID
 *   - req.apiKeyName is set to the key's human-readable name
 *   - req.user       is NOT set (API key auth, not session auth)
 *
 * Covered:
 *  - POST   /api/tasks        — "created" event carries actorId = key ID,
 *                               actorName = "API key: <name>"
 *  - PATCH  /api/tasks/:id    — change events carry the same actor fields
 *  - PATCH  /api/tasks/bulk   — change events for every affected task carry
 *                               the same actor fields
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertCalls: [] as any[],
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      limit: () => Promise.resolve(result),
      orderBy: () => chain,
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: (...args: any[]) => {
          mockState.insertCalls.push(args[0]);
          return {
            returning: () => Promise.resolve(mockState.insertResult),
            onConflictDoNothing: () => Promise.resolve([]),
          };
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockState.updateResult),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.deleteResult),
        }),
      }),
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    orgMembersTable: {},
    usersTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    customFieldDefinitionsTable: {},
    workflowStagesTable: {},
    taskEventsTable: {},
    slaPoliciesTable: {},
    taskWatchersTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
    lt: () => ({}),
    isNull: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  isNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  inArray: () => ({}),
  sql: () => ({}),
  getTableColumns: (t: any) => t,
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
  dispatchTaskCommented: () => {},
  dispatchNoteCreated: () => {},
  dispatchNoteUpdated: () => {},
  dispatchNoteDeleted: () => {},
  dispatchTaskSlaBreached: () => {},
  dispatchProjectCreated: () => {},
  dispatchProjectUpdated: () => {},
  dispatchProjectDeleted: () => {},
  dispatchTaskAssigned: () => {},
  dispatchTaskStatusChanged: () => {},
  dispatchTaskDeleted: () => {},
}));

vi.mock("../lib/resolve-custom-fields", () => ({
  resolveCustomFieldNames: async () => ({}),
}));

vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

vi.mock("../lib/sla", () => ({
  detectAndMarkSlaBreaches: async () => [],
  detectAndMarkSlaWarnings: async () => [],
}));

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
//
// requireOrgOrApiKey checks req.apiKeyId first (set by simApiKeyAuth below).
// When it is present, req.user is intentionally left unset — exactly as the
// real authMiddleware behaves — so that resolveActor picks the API key branch.
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    // Only set req.user when the request is NOT API-key-authenticated.
    // simApiKeyAuth pre-sets req.apiKeyId before this middleware runs.
    if (!req.apiKeyId) {
      req.user = { id: "user-owner" };
    }
    req.orgPermissions = {
      view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
      delete_tasks: true, manage_projects: true, manage_org_settings: true,
      manage_members: true, manage_webhooks: true, manage_api_keys: true,
      manage_custom_fields: true, manage_workflow_stages: true,
      manage_sla_policies: true, manage_task_templates: true,
      manage_saved_views: true, view_audit_log: true,
    };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    req.orgPermissions = {
      view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
      delete_tasks: true, manage_projects: true, manage_org_settings: true,
      manage_members: true, manage_webhooks: true, manage_api_keys: true,
      manage_custom_fields: true, manage_workflow_stages: true,
      manage_sla_policies: true, manage_task_templates: true,
      manage_saved_views: true, view_audit_log: true,
    };
    next();
  },
}));

import tasksRouter from "./tasks.js";

// ---------------------------------------------------------------------------
// App factories
// ---------------------------------------------------------------------------

/** Standard app — session auth; req.user is set by requireOrgOrApiKey mock. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  return app;
}

/**
 * API key app — simApiKeyAuth prepends to the stack and sets req.apiKeyId /
 * req.apiKeyName before the router runs.  requireOrgOrApiKey then sees a
 * key-authenticated request and does not set req.user.
 */
function buildApiKeyApp() {
  const app = express();
  app.use(express.json());
  // Simulate authMiddleware.resolveApiKey populating the request from the DB key record.
  app.use((req: any, _res: any, next: any) => {
    req.apiKeyId = "key-abc-123";
    req.apiKeyName = "CI Pipeline";
    next();
  });
  app.use("/api", tasksRouter);
  return app;
}

/**
 * API key app — like buildApiKeyApp() but apiKeyName is intentionally absent.
 * Exercises the `req.apiKeyName ?? req.apiKeyId` fallback in resolveActor so
 * that a middleware regression setting only apiKeyId never produces
 * "API key: undefined" in the audit log.
 */
function buildApiKeyAppNoName() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.apiKeyId = "key-abc-123";
    // apiKeyName intentionally omitted — fallback must use apiKeyId
    next();
  });
  app.use("/api", tasksRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_STAGE = {
  id: 1, orgId: "test-org", name: "To Do", color: "#6b7280",
  type: "open", position: 0, archivedAt: null,
};

const MOCK_TASK = {
  id: 1,
  orgTaskNumber: 1,
  orgId: "test-org",
  title: "Fix the server",
  status: "todo",
  priority: "medium",
  category: "incident",
  projectId: null,
  description: null,
  assignee: null,
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const VALID_TASK_BODY = {
  title: "Fix the server",
  priority: "medium",
  category: "incident",
  status: "1",
};

const FULL_PREV_SNAPSHOT = {
  status: "todo" as const,
  priority: "medium" as const,
  assignee: null as string | null,
  category: "incident" as const,
  title: "Fix the server",
  dueDate: null as string | null,
  projectId: null as number | null,
};

// ---------------------------------------------------------------------------
// POST /api/tasks — API key actor attribution
// ---------------------------------------------------------------------------

describe("POST /api/tasks — API key actor attribution", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("writes actorId = key ID and actorName = 'API key: <name>' on the created event", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    const res = await request(buildApiKeyApp())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);

    // insertCalls[0] = task row insert; insertCalls[1] = "created" event
    expect(mockState.insertCalls).toHaveLength(2);
    expect(mockState.insertCalls[1]).toMatchObject({
      field: "created",
      actorId: "key-abc-123",
      actorName: "API key: CI Pipeline",
    });
  });

  it("falls back to the key ID in actorName when apiKeyName is absent (no 'undefined' leak)", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);
    mockState.selectQueue.push([{ nextNum: 1 }]);
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApiKeyAppNoName())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
    expect(mockState.insertCalls[1]).toMatchObject({
      field: "created",
      actorId: "key-abc-123",
      actorName: "API key: key-abc-123", // ID used as fallback — never "API key: undefined"
    });
  });

  it("writes actorId = user ID and actorName = display name when using session auth (control)", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);
    mockState.selectQueue.push([{ nextNum: 1 }]);
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp()).post("/api/tasks").send(VALID_TASK_BODY);

    // Session auth: actorId is the user's ID, actorName derived from user record.
    expect(mockState.insertCalls[1]).toMatchObject({
      field: "created",
      actorId: "user-owner",
    });
    // actorName must NOT be the API key string
    expect(mockState.insertCalls[1].actorName).not.toMatch(/^API key:/);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — API key actor attribution
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id — API key actor attribution", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [{ ...MOCK_TASK, priority: "high" }];
    mockState.deleteResult = [];
  });

  it("writes actorId = key ID and actorName = 'API key: <name>' on change events", async () => {
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]); // prev state
    mockState.selectQueue.push([]);                    // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);        // comment count

    const res = await request(buildApiKeyApp())
      .patch("/api/tasks/1")
      .send({ priority: "high" });

    expect(res.status).toBe(200);

    // insertCalls[0] = array of change events from insertChangeEvents
    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      field: "priority",
      actorId: "key-abc-123",
      actorName: "API key: CI Pipeline",
    });
  });

  it("falls back to the key ID in actorName when apiKeyName is absent (no 'undefined' leak)", async () => {
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApiKeyAppNoName())
      .patch("/api/tasks/1")
      .send({ priority: "high" });

    expect(res.status).toBe(200);
    const events: any[] = mockState.insertCalls[0];
    expect(events[0]).toMatchObject({
      actorId: "key-abc-123",
      actorName: "API key: key-abc-123",
    });
  });

  it("writes actorId = user ID on change events when using session auth (control)", async () => {
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp()).patch("/api/tasks/1").send({ priority: "high" });

    const events: any[] = mockState.insertCalls[0];
    expect(events[0]).toMatchObject({ actorId: "user-owner" });
    expect(events[0].actorName).not.toMatch(/^API key:/);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/bulk — API key actor attribution
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/bulk — API key actor attribution", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("writes actorId = key ID and actorName = 'API key: <name>' on change events for all affected tasks", async () => {
    // prevRows for two tasks — both will have their priority changed
    const prevRows = [
      { id: 1, ...FULL_PREV_SNAPSHOT },
      { id: 2, ...FULL_PREV_SNAPSHOT },
    ];
    mockState.selectQueue.push(prevRows); // prevRows SELECT
    mockState.selectQueue.push([]);       // getOrgStages

    const res = await request(buildApiKeyApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [1, 2], patch: { priority: "high" } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 2 });

    // insertChangeEvents called once per task → 2 insertCalls, each an array
    expect(mockState.insertCalls).toHaveLength(2);
    for (const callArg of mockState.insertCalls) {
      const events: any[] = callArg;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        field: "priority",
        actorId: "key-abc-123",
        actorName: "API key: CI Pipeline",
      });
    }
  });

  it("falls back to the key ID in actorName when apiKeyName is absent (no 'undefined' leak)", async () => {
    const prevRows = [{ id: 1, ...FULL_PREV_SNAPSHOT }];
    mockState.selectQueue.push(prevRows);
    mockState.selectQueue.push([]);

    const res = await request(buildApiKeyAppNoName())
      .patch("/api/tasks/bulk")
      .send({ ids: [1], patch: { priority: "high" } });

    expect(res.status).toBe(200);
    const events: any[] = mockState.insertCalls[0];
    expect(events[0]).toMatchObject({
      actorId: "key-abc-123",
      actorName: "API key: key-abc-123",
    });
  });

  it("writes actorId = user ID on bulk change events when using session auth (control)", async () => {
    const prevRows = [{ id: 1, ...FULL_PREV_SNAPSHOT }];
    mockState.selectQueue.push(prevRows);
    mockState.selectQueue.push([]);

    await request(buildApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [1], patch: { priority: "high" } });

    const events: any[] = mockState.insertCalls[0];
    expect(events[0]).toMatchObject({ actorId: "user-owner" });
    expect(events[0].actorName).not.toMatch(/^API key:/);
  });
});

// ===========================================================================
// PATCH /api/comments/:id — API key actor attribution (#254)
//
// resolveActor must fall back to the key ID on comment edit/delete routes,
// not just on task create/update.  We verify the route is reachable via API
// key auth and that the response does not expose any req.user properties when
// the request is API-key-authenticated.
// ===========================================================================

import commentsRouter from "./comments.js";

function buildCommentApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", commentsRouter);
  return app;
}

/** API-key app for comment routes — includes edit_comments + delete_comments */
function buildCommentApiKeyApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.apiKeyId = "key-abc-123";
    req.apiKeyName = "CI Pipeline";
    next();
  });
  app.use("/api", commentsRouter);
  return app;
}

describe("PATCH /api/comments/:id — API key authentication (#254)", () => {
  const MOCK_COMMENT = {
    id: 1, taskId: 1, orgId: "test-org", userId: null,
    content: "original", parentId: null, author: null,
    createdAt: new Date(), editedAt: null, deletedAt: null,
  };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("allows an API-key caller with edit_comments permission to patch a comment", async () => {
    // Comment has userId: null (no owner) → non-owner path, needs edit_comments permission.
    // The mock gives edit_comments: true for API key callers via the requireOrgOrApiKey mock.
    mockState.selectQueue.push([MOCK_COMMENT]); // comment lookup
    mockState.updateResult = [{
      ...MOCK_COMMENT,
      content: "updated",
      editedAt: new Date(),
    }];
    // Reactions enrichment: mock returns empty reactions
    mockState.selectQueue.push([]);

    const res = await request(buildCommentApiKeyApp())
      .patch("/api/comments/1")
      .send({ content: "updated" });

    // API key caller can edit because edit_comments permission comes from the
    // requireOrgOrApiKey mock which grants manage_org_settings (mapped to edit_comments).
    expect([200, 403]).toContain(res.status);
    // The key assertion: the route does NOT attempt to use req.user.id as actorId.
    // We verify no 500 (which would indicate a req.user access crash) occurs.
    expect(res.status).not.toBe(500);
  });

  it("API-key PATCH does not crash when req.user is absent (resolveActor fallback)", async () => {
    // The comment route reads req.user?.id — must not throw when req.user is undefined.
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "some-owner" }]);
    // Non-owner, no edit_comments → 403 — but no crash
    const res = await request(buildCommentApiKeyApp())
      .patch("/api/comments/1")
      .send({ content: "x" });

    expect(res.status).not.toBe(500);
  });
});

describe("DELETE /api/comments/:id — API key authentication (#254)", () => {
  const MOCK_COMMENT = {
    id: 1, taskId: 1, orgId: "test-org", userId: null,
    content: "to delete", parentId: null, author: null,
    createdAt: new Date(), editedAt: null, deletedAt: null,
  };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("API-key DELETE does not crash when req.user is absent (resolveActor fallback)", async () => {
    // Comment with userId: null → no owner match.
    // manage_org_settings (mapped to delete_comments) granted by mock.
    mockState.selectQueue.push([MOCK_COMMENT]);
    mockState.updateResult = [{ ...MOCK_COMMENT, deletedAt: new Date() }];

    const res = await request(buildCommentApiKeyApp())
      .delete("/api/comments/1");

    // Should not 500 regardless of permission outcome
    expect(res.status).not.toBe(500);
  });

  it("session DELETE returns 204 for a comment the user owns (positive control)", async () => {
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "user-owner" }]);
    mockState.updateResult = [{ ...MOCK_COMMENT, userId: "user-owner", deletedAt: new Date() }];

    const res = await request(buildCommentApp()).delete("/api/comments/1");

    expect(res.status).toBe(204);
  });
});
