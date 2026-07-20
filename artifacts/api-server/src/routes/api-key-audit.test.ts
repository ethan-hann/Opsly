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
