/**
 * Tests for SLA policy routes and breach-detection logic.
 *
 * Covered:
 *  - GET  /api/org/sla-policies  — returns current policies (all-org, no auth filter)
 *  - PUT  /api/org/sla-policies  — replaces policies; 403 without permission, 400 on bad body
 *  - detectAndMarkSlaBreaches    — sets slaBreachedAt exactly once; dispatches webhook payload;
 *                                   skips done tasks; skips tasks already marked
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

// ALL_PERMS is defined inside vi.hoisted so it is available before module initialisation.
const mockState = vi.hoisted(() => {
  const ALL_PERMS: Record<string, boolean> = {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
    manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
  };
  return {
    ALL_PERMS,
    selectQueue: [] as any[][],
    insertQueue: [] as any[][],  // each entry → result of insert().values().returning()
    insertPayloads: [] as any[], // capture of every .values(payload) call
    updateQueue: [] as any[][],  // each entry → result of update().set().where().returning()
    updateCalls: 0,
    deleteCalls: 0,
    permissions: { ...ALL_PERMS } as Record<string, boolean>,
  };
});

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

  function noop(): any {
    return {
      then(onfulfilled: any, onrejected: any) { return Promise.resolve().then(onfulfilled, onrejected); },
      catch(onrejected: any) { return Promise.resolve().catch(onrejected); },
    };
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: (payload: any) => {
          mockState.insertPayloads.push(payload);
          const next = mockState.insertQueue.shift() ?? [];
          return Object.assign(noop(), { returning: () => Promise.resolve(next) });
        },
      }),
      update: () => (mockState.updateCalls++, {
        set: () => ({
          where: () => {
            const next = mockState.updateQueue.shift() ?? [];
            return Object.assign(noop(), { returning: () => Promise.resolve(next) });
          },
        }),
      }),
      delete: () => (mockState.deleteCalls++, { where: () => noop() }),
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    orgMembersTable: {},
    usersTable: {},
    customFieldDefinitionsTable: {},
    taskEventsTable: {},
    slaPoliciesTable: {},
    organizationsTable: {},
    rolesTable: {},
    invitationsTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    workflowStagesTable: {},
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: {},
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    isNull: () => ({}),
    sql: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}), and: () => ({}), lt: () => ({}), lte: () => ({}),
  gte: () => ({}), or: () => ({}), isNull: () => ({}), asc: () => ({}),
  inArray: () => ({}), sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware — requirePermission actually checks orgPermissions
// so the 403 path is exercisable via mockState.permissions
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1" };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-1" };
    req.orgPermissions = mockState.permissions;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireOwner: (_req: any, _res: any, next: any) => next(),
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[key]) {
      return res.status(403).json({ error: `Forbidden: ${key}` });
    }
    next();
  },
}));

// ---------------------------------------------------------------------------
// Mock webhook-dispatcher — spy so we can assert breach and warning dispatch
// ---------------------------------------------------------------------------
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: vi.fn(),
  dispatchTaskUpdated: vi.fn(),
  dispatchTaskSlaBreached: vi.fn(),
  dispatchSlaWarning: vi.fn(),
}));

// Mock resolve-custom-fields (only used by POST/PATCH /tasks, not GET, but imported)
vi.mock("../lib/resolve-custom-fields", () => ({
  resolveCustomFieldNames: async () => ({}),
}));

// Passthrough @workspace/api-zod — real Zod validation would throw on partial
// fixtures; the SLA tests care about breach detection logic, not schema shape.
vi.mock("@workspace/api-zod", () => {
  const p = { parse: (x: any) => x, safeParse: (x: any) => ({ success: true, data: x }) };
  return {
    CreateTaskBody: p, UpdateTaskBody: p,
    GetTaskParams: p, UpdateTaskParams: p, DeleteTaskParams: p,
    ListTasksQueryParams: p,
    ListTasksResponse: p, CreateTaskResponse: p, GetTaskResponse: p,
    UpdateTaskResponse: p, GetOverdueTasksResponse: p,
    BulkUpdateTasksBody: p, BulkUpdateTasksResponse: p,
    BulkDeleteTasksBody: p, BulkDeleteTasksResponse: p,
    ListTaskEventsParams: p, ListTaskEventsResponse: p,
    GetSlaStatusParams: p, GetSlaStatusResponse: p,
    ListSlaPoliciesResponse: p, UpdateSlaPoliciesBody: p,
    CreateWorkflowStageBody: p, UpdateWorkflowStageBody: p,
    GetWorkflowStageParams: p, ReorderWorkflowStagesBody: p,
    ListWorkflowStagesResponse: p, CreateWorkflowStageResponse: p,
    UpdateWorkflowStageResponse: p, DeleteWorkflowStageParams: p,
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks so vi.mock hoisting applies)
// ---------------------------------------------------------------------------
import orgsRouter from "./orgs.js";
import tasksRouter from "./tasks.js";
import * as webhookDispatcher from "../lib/webhook-dispatcher";

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------
function buildOrgsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", orgsRouter);
  return app;
}

function buildTasksApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed reference timestamp — pins Date.now() for getSlaStatus calculations. */
const FIXED_NOW = new Date("2025-06-01T12:00:00.000Z").getTime();

const MOCK_SLA_POLICY = {
  id: 1,
  orgId: "test-org",
  priority: "high" as const,
  responseMinutes: 60,
  resolutionMinutes: 480,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

/**
 * A task created 2 hours before FIXED_NOW with a 60-minute resolution SLA →
 * elapsed=120 min, remaining=-60 min → isResolutionBreached=true.
 */
const BREACHED_TASK = {
  id: 1,
  orgTaskNumber: 42,
  orgId: "test-org",
  title: "Prod is down",
  status: "in_progress",
  priority: "high",
  category: "incident",
  projectId: null,
  description: null,
  assignee: null,
  dueDate: null,
  slaBreachedAt: null,          // not yet flagged
  customFields: {},
  createdAt: new Date("2025-06-01T10:00:00.000Z").toISOString(), // 2 h before FIXED_NOW
  updatedAt: new Date("2025-06-01T10:00:00.000Z").toISOString(),
};

/**
 * SLA policy with a 60-minute RESPONSE limit only (no resolutionMinutes).
 * Task is 2 h old → responseStatus = "breached" → webhook must fire even though
 * isResolutionBreached is false.
 */
const RESPONSE_ONLY_BREACH_POLICY = {
  id: 3,
  orgId: "test-org",
  priority: "high",
  responseMinutes: 60,   // 1-hour response limit — task is 2 hours old → breached
  resolutionMinutes: null,
  warningThresholdPercent: 80,
  projectId: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

/**
 * SLA policy with a 100-minute RESPONSE limit only and 80% warning threshold.
 * Task is 85 minutes old → 85% > 80% → warning fires; not yet breached.
 */
const RESPONSE_ONLY_WARNING_POLICY = {
  id: 4,
  orgId: "test-org",
  priority: "high",
  responseMinutes: 100,
  resolutionMinutes: null,
  warningThresholdPercent: 80,
  projectId: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

/** SLA policy for "high" with a 60-minute resolution limit. */
const BREACH_POLICY = {
  id: 1,
  orgId: "test-org",
  priority: "high",
  responseMinutes: null,
  resolutionMinutes: 60, // 1-hour limit — task is 2 hours old → breached
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

/**
 * A task created 85 minutes before FIXED_NOW with a 100-minute resolution SLA
 * and 80% warning threshold → 85% elapsed → warning fires (not yet breached).
 */
const WARNING_TASK = {
  id: 2,
  orgTaskNumber: 43,
  orgId: "test-org",
  title: "Server is slow",
  status: "in_progress",
  priority: "high",
  category: "incident",
  projectId: null,
  description: null,
  assignee: null,
  dueDate: null,
  slaBreachedAt: null,
  slaWarningSentAt: null,
  customFields: {},
  createdAt: new Date("2025-06-01T10:35:00.000Z").toISOString(), // 85 min before FIXED_NOW
  updatedAt: new Date("2025-06-01T10:35:00.000Z").toISOString(),
};

/** SLA policy with a 100-minute resolution limit and 80% warning threshold. */
const WARNING_POLICY = {
  id: 2,
  orgId: "test-org",
  priority: "high",
  responseMinutes: null,
  resolutionMinutes: 100, // 85 min elapsed → 85% > 80% threshold → warn; < 100 → not breached
  warningThresholdPercent: 80,
  projectId: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// Shared beforeEach / afterEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  mockState.selectQueue.length = 0;
  mockState.insertQueue.length = 0;
  mockState.insertPayloads.length = 0;
  mockState.updateQueue.length = 0;
  mockState.updateCalls = 0;
  mockState.deleteCalls = 0;
  mockState.permissions = { ...mockState.ALL_PERMS };

  vi.mocked(webhookDispatcher.dispatchTaskSlaBreached).mockClear();
  vi.mocked(webhookDispatcher.dispatchSlaWarning).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// GET /api/org/sla-policies
// ---------------------------------------------------------------------------

describe("GET /api/org/sla-policies", () => {
  it("returns 200 with an empty array when no policies are configured", async () => {
    mockState.selectQueue.push([]); // slaPoliciesTable returns nothing

    const res = await request(buildOrgsApp()).get("/api/org/sla-policies");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the org's SLA policies", async () => {
    mockState.selectQueue.push([MOCK_SLA_POLICY]);

    const res = await request(buildOrgsApp()).get("/api/org/sla-policies");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      priority: "high",
      responseMinutes: 60,
      resolutionMinutes: 480,
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/org/sla-policies
// ---------------------------------------------------------------------------

describe("PUT /api/org/sla-policies", () => {
  it("returns 403 when the caller lacks manage_sla_policies permission", async () => {
    mockState.permissions = { ...mockState.ALL_PERMS, manage_sla_policies: false };

    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({ policies: [{ priority: "high", resolutionMinutes: 480 }] });

    expect(res.status).toBe(403);
  });

  it("returns 400 when the request body is missing the policies array", async () => {
    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when the policies array contains a duplicate priority", async () => {
    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({
        policies: [
          { priority: "high", resolutionMinutes: 60 },
          { priority: "high", resolutionMinutes: 120 }, // duplicate
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate/i);
  });

  it("returns 200 with the saved policies on a valid upsert", async () => {
    const saved = { ...MOCK_SLA_POLICY, responseMinutes: null, resolutionMinutes: 120 };
    mockState.insertQueue.push([saved]);

    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({
        policies: [{ priority: "high", resolutionMinutes: 120 }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ priority: "high", resolutionMinutes: 120 });
    // Old policies must have been deleted before re-inserting
    expect(mockState.deleteCalls).toBe(1);
  });

  it("returns 200 with an empty array when policies is [] (clears all SLA targets)", async () => {
    // No insert queue entry needed — nothing to insert with an empty list
    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({ policies: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockState.deleteCalls).toBe(1);
  });

  it("skips inserting policies that have both responseMinutes and resolutionMinutes null", async () => {
    // A policy entry with both fields null/absent carries no SLA targets → filtered out
    mockState.insertQueue.push([]); // nothing inserted

    const res = await request(buildOrgsApp())
      .put("/api/org/sla-policies")
      .send({
        policies: [{ priority: "low", responseMinutes: null, resolutionMinutes: null }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectAndMarkSlaBreaches (exercised through GET /api/tasks)
// ---------------------------------------------------------------------------

describe("detectAndMarkSlaBreaches — via GET /api/tasks", () => {
  it("does nothing when there are no SLA policies configured", async () => {
    mockState.selectQueue.push([BREACHED_TASK]); // tasks list
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([]);              // SLA policies → empty
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });

  it("does not mark a task whose status is 'done' even when past the SLA deadline", async () => {
    const doneTask = { ...BREACHED_TASK, status: "done" };
    mockState.selectQueue.push([doneTask]);       // tasks list
    mockState.selectQueue.push([]);               // getOrgStages → no custom stages
    mockState.selectQueue.push([BREACH_POLICY]);  // SLA policy present
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });

  it("does not re-mark a task that already has slaBreachedAt set", async () => {
    const alreadyMarked = { ...BREACHED_TASK, slaBreachedAt: new Date("2025-06-01T11:30:00.000Z") };
    mockState.selectQueue.push([alreadyMarked]); // tasks list
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([BREACH_POLICY]); // SLA policy present
    mockState.selectQueue.push([{ count: 0 }]);  // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });

  it("sets slaBreachedAt and dispatches the webhook when an open task breaches its resolution SLA", async () => {
    mockState.selectQueue.push([BREACHED_TASK]);           // tasks list
    mockState.selectQueue.push([]);                        // getOrgStages → no custom stages
    mockState.selectQueue.push([BREACH_POLICY]);           // SLA policies
    // Atomic update succeeds (simulates winning the IS NULL race)
    mockState.updateQueue.push([{ id: BREACHED_TASK.id }]);
    mockState.selectQueue.push([{ count: 0 }]);            // comment count for buildTaskWithProject

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);

    // slaBreachedAt must have been stamped exactly once
    expect(mockState.updateCalls).toBe(1);

    // Webhook payload must be dispatched with the right org, task, and overdue duration
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).toHaveBeenCalledWith(
      "test-org",       // orgId
      null,             // projectId (BREACHED_TASK.projectId = null)
      expect.objectContaining({
        id: BREACHED_TASK.id,
        title: BREACHED_TASK.title,
        priority: BREACHED_TASK.priority,
        status: BREACHED_TASK.status,
        slaBreachedAt: expect.any(String), // ISO timestamp set by detectAndMarkSlaBreaches
      }),
      60, // minutesOverdue: elapsed=120 min, limit=60 min → Math.abs(-60) = 60
    );
  });

  it("does not dispatch the webhook when the DB update returns empty (another process won the race)", async () => {
    mockState.selectQueue.push([BREACHED_TASK]); // tasks list
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([BREACH_POLICY]); // SLA policies
    // update returns [] → another process already stamped slaBreachedAt
    mockState.updateQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1); // update was attempted
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// detectAndMarkSlaBreaches — SLA warning (via GET /api/tasks)
// ---------------------------------------------------------------------------

describe("detectAndMarkSlaBreaches — SLA warning via GET /api/tasks", () => {
  it("sets slaWarningSentAt and dispatches task.sla_warning when elapsed% >= threshold", async () => {
    mockState.selectQueue.push([WARNING_TASK]);             // tasks list
    mockState.selectQueue.push([]);                         // getOrgStages → no custom stages
    mockState.selectQueue.push([WARNING_POLICY]);           // SLA policies
    // Atomic update for slaWarningSentAt succeeds
    mockState.updateQueue.push([{ id: WARNING_TASK.id }]);
    mockState.selectQueue.push([{ count: 0 }]);             // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1);
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).toHaveBeenCalledWith(
      "test-org",
      null,
      expect.objectContaining({
        id: WARNING_TASK.id,
        title: WARNING_TASK.title,
        priority: WARNING_TASK.priority,
        status: WARNING_TASK.status,
      }),
      85,           // percentElapsed: Math.round(85/100 * 100) = 85
      expect.any(String), // projectedBreachAt ISO string
      15,           // minutesUntilBreach: Math.max(0, round(100 - 85)) = 15
    );
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });

  it("does not fire task.sla_warning when elapsed% is below the threshold", async () => {
    // Task created 70 minutes ago → 70% elapsed < 80% threshold → no warning
    const earlyTask = {
      ...WARNING_TASK,
      createdAt: new Date("2025-06-01T10:50:00.000Z").toISOString(), // 70 min before FIXED_NOW
    };
    mockState.selectQueue.push([earlyTask]);
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([WARNING_POLICY]);
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).not.toHaveBeenCalled();
  });

  it("does not fire task.sla_warning when the task is already breached", async () => {
    // BREACHED_TASK is 120 min old with a 60-min limit → isResolutionBreached=true
    // breach path fires, warning else-branch is skipped
    mockState.selectQueue.push([BREACHED_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([BREACH_POLICY]);
    mockState.updateQueue.push([{ id: BREACHED_TASK.id }]); // breach update wins
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1); // only the breach update
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).not.toHaveBeenCalled();
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).toHaveBeenCalledOnce();
  });

  it("does not re-send task.sla_warning when slaWarningSentAt is already set", async () => {
    const alreadyWarned = {
      ...WARNING_TASK,
      slaWarningSentAt: new Date("2025-06-01T11:50:00.000Z"), // already warned
    };
    mockState.selectQueue.push([alreadyWarned]);
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([WARNING_POLICY]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).not.toHaveBeenCalled();
  });

  it("does not dispatch task.sla_warning when the DB update returns empty (race condition)", async () => {
    mockState.selectQueue.push([WARNING_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([WARNING_POLICY]);
    // update returns [] → another process won the race
    mockState.updateQueue.push([]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1); // update was attempted
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).not.toHaveBeenCalled();
  });

  it("fires task.sla_warning but not task.sla_breached for a task approaching but not past its deadline", async () => {
    mockState.selectQueue.push([WARNING_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages → no custom stages
    mockState.selectQueue.push([WARNING_POLICY]);
    mockState.updateQueue.push([{ id: WARNING_TASK.id }]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// detectAndMarkSlaBreaches — response-SLA-only policies
// ---------------------------------------------------------------------------
// These tests cover the case where a policy only has responseMinutes configured
// (resolutionMinutes is null).  The badge still shows a countdown for the
// response SLA, so webhooks must fire for response-SLA breaches/warnings too.

describe("detectAndMarkSlaBreaches — response-SLA-only policy via GET /api/tasks", () => {
  it("fires task.sla_breached when an open task breaches its response SLA (no resolutionMinutes)", async () => {
    // BREACHED_TASK is 120 min old; RESPONSE_ONLY_BREACH_POLICY has responseMinutes=60
    // → responseStatus="breached", isResolutionBreached=false → webhook must still fire
    mockState.selectQueue.push([BREACHED_TASK]);
    mockState.selectQueue.push([]);                          // getOrgStages
    mockState.selectQueue.push([RESPONSE_ONLY_BREACH_POLICY]);
    mockState.updateQueue.push([{ id: BREACHED_TASK.id }]); // atomic update wins
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1);
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).toHaveBeenCalledWith(
      "test-org",
      null,
      expect.objectContaining({
        id: BREACHED_TASK.id,
        priority: BREACHED_TASK.priority,
        status: BREACHED_TASK.status,
        slaBreachedAt: expect.any(String),
      }),
      60, // Math.abs(-60) response minutes overdue
    );
  });

  it("fires task.sla_warning when a task crosses the response-SLA warning threshold", async () => {
    // WARNING_TASK is 85 min old; RESPONSE_ONLY_WARNING_POLICY has responseMinutes=100
    // → 85/100 = 85% > 80% threshold → warning fires
    mockState.selectQueue.push([WARNING_TASK]);
    mockState.selectQueue.push([]);                          // getOrgStages
    mockState.selectQueue.push([RESPONSE_ONLY_WARNING_POLICY]);
    mockState.updateQueue.push([{ id: WARNING_TASK.id }]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(1);
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookDispatcher.dispatchSlaWarning)).toHaveBeenCalledWith(
      "test-org",
      null,
      expect.objectContaining({ id: WARNING_TASK.id }),
      85, // percentElapsed
      expect.any(String), // projectedBreachAt
      15, // minutesUntilBreach: round(100 - 85)
    );
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });

  it("does not fire task.sla_breached for a done task even with response-SLA-only policy", async () => {
    const doneTask = { ...BREACHED_TASK, status: "done" };
    mockState.selectQueue.push([doneTask]);
    mockState.selectQueue.push([]);                          // getOrgStages
    mockState.selectQueue.push([RESPONSE_ONLY_BREACH_POLICY]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toBe(0);
    expect(vi.mocked(webhookDispatcher.dispatchTaskSlaBreached)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// detectAndMarkSlaBreaches — audit trail (task_events rows)
// ---------------------------------------------------------------------------

describe("detectAndMarkSlaBreaches — audit events via GET /api/tasks", () => {
  it("inserts a task_event row with field='sla_breached' and newValue='resolution|<ISO>' when the resolution SLA is breached", async () => {
    mockState.selectQueue.push([BREACHED_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages
    mockState.selectQueue.push([BREACH_POLICY]);
    mockState.updateQueue.push([{ id: BREACHED_TASK.id }]); // atomic update wins
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    // The audit event must encode the SLA type so the history feed can label it correctly.
    // Format: "<type>|<ISO timestamp>"
    expect(mockState.insertPayloads).toContainEqual(
      expect.objectContaining({
        taskId: BREACHED_TASK.id,
        orgId: "test-org",
        actorId: null,
        actorName: null,
        field: "sla_breached",
        oldValue: null,
        newValue: expect.stringMatching(/^resolution\|/), // resolution SLA was the limit crossed
      }),
    );
  });

  it("inserts a task_event row with newValue='response|<ISO>' when only the response SLA is breached", async () => {
    // BREACHED_TASK is 120 min old; RESPONSE_ONLY_BREACH_POLICY has responseMinutes=60 only
    // → isResolutionBreached=false, responseStatus="breached" → slaType must be "response"
    mockState.selectQueue.push([BREACHED_TASK]);
    mockState.selectQueue.push([]);                            // getOrgStages
    mockState.selectQueue.push([RESPONSE_ONLY_BREACH_POLICY]);
    mockState.updateQueue.push([{ id: BREACHED_TASK.id }]);   // atomic update wins
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.insertPayloads).toContainEqual(
      expect.objectContaining({
        taskId: BREACHED_TASK.id,
        field: "sla_breached",
        oldValue: null,
        newValue: expect.stringMatching(/^response\|/), // response SLA was the limit crossed
      }),
    );
  });

  it("does not insert a sla_breached event when the DB update returns empty (race lost)", async () => {
    mockState.selectQueue.push([BREACHED_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages
    mockState.selectQueue.push([BREACH_POLICY]);
    mockState.updateQueue.push([]);              // another process won
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    const slaBreachInserts = mockState.insertPayloads.filter(
      (p: any) => p?.field === "sla_breached",
    );
    expect(slaBreachInserts).toHaveLength(0);
  });

  it("inserts a task_event row with field='sla_warning' when the warning threshold is crossed", async () => {
    mockState.selectQueue.push([WARNING_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages
    mockState.selectQueue.push([WARNING_POLICY]);
    mockState.updateQueue.push([{ id: WARNING_TASK.id }]); // atomic update wins
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(mockState.insertPayloads).toContainEqual(
      expect.objectContaining({
        taskId: WARNING_TASK.id,
        orgId: "test-org",
        actorId: null,
        actorName: null,
        field: "sla_warning",
        oldValue: null,
        newValue: expect.any(String), // projected breach ISO timestamp
      }),
    );
  });

  it("does not insert a sla_warning event when the DB update returns empty (race lost)", async () => {
    mockState.selectQueue.push([WARNING_TASK]);
    mockState.selectQueue.push([]);              // getOrgStages
    mockState.selectQueue.push([WARNING_POLICY]);
    mockState.updateQueue.push([]);              // another process won
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildTasksApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    const slaWarnInserts = mockState.insertPayloads.filter(
      (p: any) => p?.field === "sla_warning",
    );
    expect(slaWarnInserts).toHaveLength(0);
  });
});
