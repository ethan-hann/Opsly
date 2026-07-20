/**
 * Tests for tasks routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /tasks/overdue - list enriched overdue tasks
 *  - GET  /tasks         - list all tasks, filter by projectId/status/priority/category
 *  - GET  /tasks/:id     - 200 with enriched task, 404, 400 bad id
 *  - POST /tasks         - body validation, projectId validation, assignee validation, 201
 *  - PATCH /tasks/:id    - params/body validation, projectId validation, assignee validation, 404, 200
 *  - DELETE /tasks/:id   - 204, 404, 400 bad id
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  // Tracks every argument passed to db.insert(...).values(arg) in insertion order.
  // insertCalls[0] is the first .values() call, insertCalls[1] the second, etc.
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
  // getTableColumns is used in the overdue route; returning the table arg lets
  // the mock chain consume selects normally without a real DB column descriptor.
  getTableColumns: (t: any) => t,
}));

// Webhook dispatcher makes unawaited async DB calls that would race with the
// next test's selectQueue. Mock it as a no-op for all unit tests here.
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

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    req.orgPermissions = {
      view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
      delete_tasks: true, manage_projects: true, manage_org_settings: true,
      manage_members: true, manage_webhooks: true, manage_api_keys: true,
      manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
      manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
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
      manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
      manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
    };
    next();
  },
}));

import tasksRouter from "./tasks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  return app;
}

// Minimal stage row to satisfy resolveStage and getOrgStages in mocked tests.
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
  status: "1", // numeric stage ID string; resolveStage is called unconditionally by POST route
};

// Push queue entries for GET /tasks/:id (task found, no projectId).
// Order: task lookup → getOrgStages (Promise.all slot 1) → SLA policies (Promise.all slot 2) → comment count.
function pushEnrichedTask(task = MOCK_TASK) {
  mockState.selectQueue.push([task]);
  mockState.selectQueue.push([]); // getOrgStages (Promise.all slot 1)
  mockState.selectQueue.push([]); // SLA policies (Promise.all slot 2)
  mockState.selectQueue.push([{ count: 0 }]);
}

// ---------------------------------------------------------------------------
// GET /api/tasks/overdue
// ---------------------------------------------------------------------------

describe("GET /api/tasks/overdue", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with an empty array when there are no overdue tasks", async () => {
    mockState.selectQueue.push([]); // tasks query returns nothing

    const res = await request(buildApp()).get("/api/tasks/overdue");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with enriched overdue tasks", async () => {
    // The route does SELECT { task: tasksTable } … innerJoin(workflowStagesTable, …)
    // so each result row is shaped { task: <taskRow> }, not a flat task.
    mockState.selectQueue.push([{ task: MOCK_TASK }]); // overdue tasks (innerJoin shape)
    mockState.selectQueue.push([]); // getOrgStages (called when taskRows.length > 0)
    mockState.selectQueue.push([{ count: 2 }]); // comment count for the task

    const res = await request(buildApp()).get("/api/tasks/overdue");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, title: "Fix the server", commentCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------

describe("GET /api/tasks", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with an empty array when there are no tasks", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with enriched tasks", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task list
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, title: "Fix the server", commentCount: 0 });
  });

  it("accepts projectId, status, priority, and category query filters", async () => {
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 1 }]);

    const res = await request(buildApp()).get(
      "/api/tasks?projectId=5&status=todo&priority=medium&category=incident",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("passes unrecognized status strings through (schema uses coerce.string, not enum)", async () => {
    // ListTasksQueryParams.status is zod.coerce.string(), not an enum - unknown
    // values are forwarded to the DB layer rather than rejected at the route level.
    mockState.selectQueue.push([]); // tasks query returns empty list
    const res = await request(buildApp()).get("/api/tasks?status=not_a_status");
    expect(res.status).toBe(200);
  });

  it("accepts an assignee filter and returns 200", async () => {
    const assignedTask = { ...MOCK_TASK, assignee: "alice@example.com" };
    mockState.selectQueue.push([assignedTask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get("/api/tasks?assignee=alice%40example.com");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].assignee).toBe("alice@example.com");
  });

  it("returns empty array when no tasks match the assignee filter", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks?assignee=nobody%40example.com");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("accepts a dateFrom filter and returns tasks on or after that date", async () => {
    const datedTask = { ...MOCK_TASK, dueDate: "2025-06-15" };
    mockState.selectQueue.push([datedTask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get("/api/tasks?dateFrom=2025-06-01");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("accepts a dateTo filter and returns tasks on or before that date", async () => {
    const datedTask = { ...MOCK_TASK, dueDate: "2025-05-10" };
    mockState.selectQueue.push([datedTask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get("/api/tasks?dateTo=2025-05-31");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("accepts dateFrom and dateTo together as a date-range filter", async () => {
    const datedTask = { ...MOCK_TASK, dueDate: "2025-06-15" };
    mockState.selectQueue.push([datedTask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get("/api/tasks?dateFrom=2025-06-01&dateTo=2025-06-30");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("accepts all filters combined: assignee + dateFrom + dateTo + status + priority", async () => {
    const fullTask = { ...MOCK_TASK, assignee: "alice@example.com", dueDate: "2025-06-15" };
    mockState.selectQueue.push([fullTask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(
      "/api/tasks?assignee=alice%40example.com&dateFrom=2025-06-01&dateTo=2025-06-30&status=todo&priority=medium",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with the enriched task when found", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task lookup
    mockState.selectQueue.push([]); // getOrgStages (Promise.all slot 1)
    mockState.selectQueue.push([]); // SLA policies (Promise.all slot 2)
    mockState.selectQueue.push([{ count: 3 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: "Fix the server", commentCount: 3 });
  });

  it("returns 404 when the task does not exist", async () => {
    mockState.selectQueue.push([]); // task not found

    const res = await request(buildApp()).get("/api/tasks/999");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).get("/api/tasks/not-a-number");
    expect(res.status).toBe(400);
  });

  it("enriches the task with project name when projectId is set", async () => {
    const taskWithProject = { ...MOCK_TASK, projectId: 5 };
    mockState.selectQueue.push([taskWithProject]); // task lookup
    mockState.selectQueue.push([]); // getOrgStages (Promise.all slot 1)
    mockState.selectQueue.push([]); // SLA policies (Promise.all slot 2)
    mockState.selectQueue.push([{ name: "Infra Upgrade" }]); // project lookup
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: 5, projectName: "Infra Upgrade" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks - body validation
// ---------------------------------------------------------------------------

describe("POST /api/tasks - body validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ status: "todo", priority: "low", category: "incident" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is not in the org", async () => {
    mockState.selectQueue.push([MOCK_STAGE]); // resolveStage SELECT
    mockState.selectQueue.push([]);           // projectBelongsToOrg → not found

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, projectId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/projectId/i) });
  });

  it("returns 201 with the created task on success", async () => {
    mockState.insertResult = [MOCK_TASK];
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber) for new task number
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]); // buildTaskWithProject comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, title: "Fix the server" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks - assignee validation (existing coverage, kept)
// ---------------------------------------------------------------------------

describe("POST /api/tasks - assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("accepts a task with no assignee (unassigned)", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).post("/api/tasks").send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
  });

  it("accepts a task whose assignee is an org member", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);            // resolveStage SELECT
    mockState.selectQueue.push([{ userId: "user-1" }]); // assignee in org
    mockState.selectQueue.push([{ nextNum: 1 }]);        // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                      // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);          // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "member@example.com" });

    expect(res.status).toBe(201);
  });

  it("rejects a task whose assignee is not an org member", async () => {
    mockState.selectQueue.push([MOCK_STAGE]); // resolveStage SELECT
    mockState.selectQueue.push([]);           // assignee not in org

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/member/i) });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id - validation + business logic
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id - validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).patch("/api/tasks/bad-id").send({ status: "done" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the task does not exist", async () => {
    // No status → resolveStage not called; empty queue → prev SELECT returns [] → 404
    const res = await request(buildApp())
      .patch("/api/tasks/999")
      .send({ title: "Updated" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when projectId is not in the org", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([]); // projectBelongsToOrg → not found

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ projectId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/projectId/i) });
  });

  it("returns 200 on a successful status update", async () => {
    const updated = { ...MOCK_TASK, status: "1" };
    mockState.updateResult = [updated];
    mockState.selectQueue.push([MOCK_STAGE]);                          // resolveStage SELECT
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ status: "1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1 });
  });

  it("returns 200 when assigning a valid projectId", async () => {
    const updated = { ...MOCK_TASK, projectId: 5 };
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([{ id: 5 }]); // projectBelongsToOrg → found
    mockState.updateResult = [updated];
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ name: "Infra Upgrade" }]); // project name
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ projectId: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: 5 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id - assignee validation (existing coverage, kept)
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id - assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("accepts a patch with no assignee field", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).patch("/api/tasks/1").send({ title: "Updated" });

    expect(res.status).toBe(200);
  });

  it("accepts a patch whose assignee is an org member", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([{ userId: "user-1" }]);
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "member@example.com" });

    expect(res.status).toBe(200);
  });

  it("rejects a patch whose assignee is not an org member", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([]); // assigneeBelongsToOrg → not found

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/member/i) });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks - custom field validation
// ---------------------------------------------------------------------------

describe("POST /api/tasks - custom field validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  const TEXT_FIELD_DEF = { id: 10, name: "Notes", type: "text", options: null, orgId: "test-org", deletedAt: null, position: 0, createdAt: "", updatedAt: "" };
  const NUMBER_FIELD_DEF = { id: 11, name: "Severity Score", type: "number", options: null, orgId: "test-org", deletedAt: null, position: 1, createdAt: "", updatedAt: "" };
  const SELECT_FIELD_DEF = { id: 12, name: "Environment", type: "single_select", options: ["prod", "staging"], orgId: "test-org", deletedAt: null, position: 2, createdAt: "", updatedAt: "" };
  const DATE_FIELD_DEF = { id: 13, name: "Due Date Override", type: "date", options: null, orgId: "test-org", deletedAt: null, position: 3, createdAt: "", updatedAt: "" };
  const MULTI_SELECT_DEF = { id: 14, name: "Tags", type: "multi_select", options: ["bug", "feature", "hotfix"], orgId: "test-org", deletedAt: null, position: 4, createdAt: "", updatedAt: "" };

  it("rejects a non-string value for a text field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);     // resolveStage SELECT
    // validateAndSanitizeCustomFields selects definitions
    mockState.selectQueue.push([TEXT_FIELD_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "10": 999 } }); // number, not string

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Notes/);
    expect(res.body.error).toMatch(/text/i);
  });

  it("rejects an out-of-range option for a single_select field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([SELECT_FIELD_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "12": "local" } }); // not in options

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Environment/);
  });

  it("rejects a non-numeric value for a number field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);       // resolveStage SELECT
    mockState.selectQueue.push([NUMBER_FIELD_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "11": "not-a-number" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Severity Score/);
  });

  it("strips unknown field IDs and creates the task successfully", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    // Definitions list has only field 10; field "99" is unknown → stripped
    mockState.selectQueue.push([TEXT_FIELD_DEF]); // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ nextNum: 1 }]);  // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);    // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "10": "valid note", "99": "unknown" } });

    expect(res.status).toBe(201);
  });

  it("accepts valid custom field values and creates the task", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);       // resolveStage SELECT
    mockState.selectQueue.push([TEXT_FIELD_DEF]);  // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ nextNum: 1 }]);  // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);    // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "10": "my note" } });

    expect(res.status).toBe(201);
  });

  it("allows null to clear any custom field value", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);       // resolveStage SELECT
    mockState.selectQueue.push([TEXT_FIELD_DEF]);  // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ nextNum: 1 }]);  // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);    // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "10": null } });

    expect(res.status).toBe(201);
  });

  it("rejects an invalid date format for a date field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);    // resolveStage SELECT
    mockState.selectQueue.push([DATE_FIELD_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "13": "not-a-date" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Due Date Override/);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it("accepts a valid YYYY-MM-DD date value and creates the task", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([DATE_FIELD_DEF]); // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "13": "2024-06-15" } });

    expect(res.status).toBe(201);
  });

  it("rejects a non-array value for a multi_select field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);       // resolveStage SELECT
    mockState.selectQueue.push([MULTI_SELECT_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "14": "bug" } }); // string, not array

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tags/);
    expect(res.body.error).toMatch(/array/i);
  });

  it("rejects an out-of-range option in a multi_select field with 400", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);       // resolveStage SELECT
    mockState.selectQueue.push([MULTI_SELECT_DEF]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "14": ["bug", "unknown-tag"] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tags/);
  });

  it("accepts a valid multi_select array and creates the task", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);        // resolveStage SELECT
    mockState.selectQueue.push([MULTI_SELECT_DEF]); // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ nextNum: 1 }]);   // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                 // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);     // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, customFields: { "14": ["bug", "hotfix"] } });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id - custom field validation and merge
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id - custom field validation and merge", () => {
  const TEXT_FIELD_DEF = { id: 10, name: "Notes", type: "text", options: null, orgId: "test-org", deletedAt: null, position: 0, createdAt: "", updatedAt: "" };
  const SELECT_FIELD_DEF = { id: 12, name: "Environment", type: "single_select", options: ["prod", "staging"], orgId: "test-org", deletedAt: null, position: 2, createdAt: "", updatedAt: "" };
  const DATE_FIELD_DEF = { id: 13, name: "Due Date Override", type: "date", options: null, orgId: "test-org", deletedAt: null, position: 3, createdAt: "", updatedAt: "" };
  const MULTI_SELECT_DEF = { id: 14, name: "Tags", type: "multi_select", options: ["bug", "feature", "hotfix"], orgId: "test-org", deletedAt: null, position: 4, createdAt: "", updatedAt: "" };

  const TASK_WITH_CUSTOM = {
    ...MOCK_TASK,
    customFields: { "10": "existing note", "12": "prod" },
  };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [TASK_WITH_CUSTOM];
    mockState.deleteResult = [];
  });

  it("rejects a non-string value for a text field with 400", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                      // definitions

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "10": ["array", "not", "string"] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Notes/);
  });

  it("rejects an invalid option for a single_select field with 400", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                    // definitions

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "12": "local" } }); // not in options

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Environment/);
  });

  it("merges customFields: sending one field leaves other existing fields intact", async () => {
    // The existing task has { "10": "existing note", "12": "prod" }
    // PATCH sends only { "12": "staging" } → route merges via SQL (jsonb ||) after a SELECT for existing values
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                    // definitions (validateAndSanitizeCustomFields)
    mockState.selectQueue.push([{ customFields: { "12": "prod" } }]); // existing customFields SELECT (for merge)
    // update returning already set in updateResult
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                    // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);                        // comment count
    // resolveCustomFieldNames: MOCK_TASK has no customFields → entries empty → no DB call

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "12": "staging" } });

    expect(res.status).toBe(200);
  });

  it("strips unknown field IDs and applies the patch successfully", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                      // definitions — field "99" not in list
    mockState.selectQueue.push([{ customFields: { "10": "existing note" } }]); // existing for merge
    // update returning already set in updateResult
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                      // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);                        // comment count
    mockState.selectQueue.push([]);                                    // resolveCustomFieldNames

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "10": "updated note", "99": "phantom field" } });

    expect(res.status).toBe(200);
  });

  it("rejects an invalid date format for a date field with 400", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([DATE_FIELD_DEF]);                      // definitions

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "13": "June 15 2024" } }); // not YYYY-MM-DD

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Due Date Override/);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it("accepts a valid YYYY-MM-DD date value in a PATCH", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]);          // prev state
    mockState.selectQueue.push([DATE_FIELD_DEF]);                               // definitions
    mockState.selectQueue.push([{ customFields: {} }]);                         // existing for merge
    // update returning already set in updateResult
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([DATE_FIELD_DEF]);                               // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);                                 // comment count
    mockState.selectQueue.push([]);                                             // resolveCustomFieldNames

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "13": "2024-06-15" } });

    expect(res.status).toBe(200);
  });

  it("rejects a non-array value for a multi_select field in a PATCH with 400", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                    // definitions

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "14": "bug" } }); // string, not array

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tags/);
    expect(res.body.error).toMatch(/array/i);
  });

  it("rejects an invalid option in a multi_select array in a PATCH with 400", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                    // definitions

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "14": ["bug", "invalid-tag"] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tags/);
  });

  it("accepts a valid multi_select array in a PATCH", async () => {
    mockState.selectQueue.push([{ status: "todo", assignee: null }]);   // prev state
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                      // definitions
    mockState.selectQueue.push([{ customFields: {} }]);                  // existing for merge
    // update returning already set in updateResult
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                      // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);                          // comment count
    mockState.selectQueue.push([]);                                      // resolveCustomFieldNames

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "14": ["feature", "hotfix"] } });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/events
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/events", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  const MOCK_EVENT = {
    id: 1,
    taskId: 1,
    orgId: "test-org",
    actorId: "user-owner",
    actorName: "Alice Smith",
    field: "status",
    oldValue: "todo",
    newValue: "in_progress",
    createdAt: new Date().toISOString(),
  };

  it("returns 200 with an empty array when no events exist", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task ownership check
    mockState.selectQueue.push([]);          // events query

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with events ordered oldest-first", async () => {
    const createdEvent = { ...MOCK_EVENT, id: 1, field: "created", oldValue: null, newValue: "Fix the server" };
    const statusEvent = { ...MOCK_EVENT, id: 2, field: "status", oldValue: "todo", newValue: "in_progress" };
    mockState.selectQueue.push([MOCK_TASK]);                  // task ownership check
    mockState.selectQueue.push([createdEvent, statusEvent]);  // events query

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ field: "created", newValue: "Fix the server" });
    expect(res.body[1]).toMatchObject({ field: "status", oldValue: "todo", newValue: "in_progress" });
  });

  it("returns 404 when the task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not found

    const res = await request(buildApp()).get("/api/tasks/999/events");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).get("/api/tasks/bad-id/events");
    expect(res.status).toBe(400);
  });

  it("returns the full event shape including all expected fields", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task ownership check
    mockState.selectQueue.push([MOCK_EVENT]); // events query

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 1,
      taskId: 1,
      orgId: "test-org",
      actorId: "user-owner",
      actorName: "Alice Smith",
      field: "status",
      oldValue: "todo",
      newValue: "in_progress",
      createdAt: expect.any(String),
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/events — SLA audit events (system-generated, actorId null)
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/events — SLA audit events", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  const SLA_BREACH_EVENT = {
    id: 10,
    taskId: 1,
    orgId: "test-org",
    actorId: null,
    actorName: null,
    field: "sla_breached",
    oldValue: null,
    newValue: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  const SLA_WARNING_EVENT = {
    id: 11,
    taskId: 1,
    orgId: "test-org",
    actorId: null,
    actorName: null,
    field: "sla_warning",
    oldValue: null,
    newValue: new Date(Date.now() + 15 * 60_000).toISOString(), // projected breach in 15 min
    createdAt: new Date().toISOString(),
  };

  it("returns sla_breached events with actorId and actorName null (system-generated)", async () => {
    mockState.selectQueue.push([MOCK_TASK]);         // task ownership check
    mockState.selectQueue.push([SLA_BREACH_EVENT]);  // events query

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      field: "sla_breached",
      actorId: null,
      actorName: null,
      oldValue: null,
      newValue: expect.any(String),
    });
  });

  it("returns sla_warning events with actorId and actorName null (system-generated)", async () => {
    mockState.selectQueue.push([MOCK_TASK]);          // task ownership check
    mockState.selectQueue.push([SLA_WARNING_EVENT]);  // events query

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      field: "sla_warning",
      actorId: null,
      actorName: null,
      oldValue: null,
      newValue: expect.any(String), // projected breach ISO timestamp
    });
  });

  it("returns both SLA and user-initiated events in the same history feed", async () => {
    const userEvent = {
      id: 5, taskId: 1, orgId: "test-org",
      actorId: "user-owner", actorName: "Alice Smith",
      field: "status", oldValue: "To Do", newValue: "In Progress",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
    };
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([userEvent, SLA_BREACH_EVENT]);

    const res = await request(buildApp()).get("/api/tasks/1/events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.some((e: any) => e.field === "status")).toBe(true);
    expect(res.body.some((e: any) => e.field === "sla_breached")).toBe(true);
  });

  it("returns 404 when the task does not belong to the org (cross-org leak blocked)", async () => {
    mockState.selectQueue.push([]); // task ownership check returns nothing

    const res = await request(buildApp()).get("/api/tasks/999/events");

    expect(res.status).toBe(404);
  });

  it("DELETE /tasks/:id/events returns 404 — no delete route exists for audit events", async () => {
    const res = await request(buildApp()).delete("/api/tasks/1/events");
    expect(res.status).toBe(404);
  });

  it("PATCH /tasks/:id/events returns 404 — no mutation route exists for audit events", async () => {
    const res = await request(buildApp()).patch("/api/tasks/1/events").send({ field: "sla_breached" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /tasks event emission
// ---------------------------------------------------------------------------

describe("POST /api/tasks - event emission", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("emits a 'created' event after inserting a task", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    // The insert mock accepts both the task insert (.returning()) and the event
    // insert (.values() without .returning()). Both use the same mock chain.
    const res = await request(buildApp())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
  });

  it("inserts a 'created' event with field='created', newValue=task title, oldValue=null", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);      // resolveStage SELECT
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);               // getOrgStages (after insert)
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    await request(buildApp()).post("/api/tasks").send(VALID_TASK_BODY);

    // insertCalls[0] = task row insert (.values() on tasksTable)
    // insertCalls[1] = "created" event insert (.values() on taskEventsTable)
    expect(mockState.insertCalls).toHaveLength(2);
    expect(mockState.insertCalls[1]).toMatchObject({
      taskId: MOCK_TASK.id,
      orgId: "test-org",
      field: "created",
      oldValue: null,
      newValue: MOCK_TASK.title,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /tasks event emission
// ---------------------------------------------------------------------------

// Full snapshot for all TRACKED_FIELDS — ensures no spurious diff events.
const FULL_PREV_SNAPSHOT = {
  status: "todo" as const,
  priority: "medium" as const,
  assignee: null as string | null,
  category: "incident" as const,
  title: "Fix the server",
  dueDate: null as string | null,
  projectId: null as number | null,
};

describe("PATCH /api/tasks/:id - event emission", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("emits change events only for fields that actually changed", async () => {
    const updated = { ...MOCK_TASK, priority: "high" };
    mockState.updateResult = [updated];
    // No status in body → resolveStage not called; no MOCK_STAGE slot needed
    mockState.selectQueue.push([{ status: "todo", assignee: null }]); // prev state
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);                        // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ priority: "high" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ priority: "high" });
  });

  it("returns 404 early when the task does not exist (no prev row)", async () => {
    // Empty prev means task not found — no events should be inserted.
    // No status in body → resolveStage not called; prev SELECT returns [] → 404.
    const res = await request(buildApp())
      .patch("/api/tasks/999")
      .send({ title: "Updated" });

    expect(res.status).toBe(404);
  });

  it("emits exactly one event for the changed field and none for unchanged fields", async () => {
    // Only priority changes: medium → high.
    // All other tracked fields are identical between prev and next.
    const updated = { ...MOCK_TASK, priority: "high" };
    mockState.updateResult = [updated];
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]); // prev state — all 7 tracked fields
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);        // comment count

    await request(buildApp()).patch("/api/tasks/1").send({ priority: "high" });

    // insertChangeEvents inserts one batch with exactly the changed fields
    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      taskId: 1,
      orgId: "test-org",
      field: "priority",
      oldValue: "medium",
      newValue: "high",
    });
  });

  it("emits no events for a no-op PATCH where all values are already identical", async () => {
    // Sending { status: "todo" } when the task is already "todo" produces no diff.
    // insertChangeEvents skips the DB insert entirely when there are no changed fields.
    mockState.updateResult = [MOCK_TASK]; // returned task matches FULL_PREV_SNAPSHOT
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp()).patch("/api/tasks/1").send({ status: "todo" });

    expect(mockState.insertCalls).toHaveLength(0);
  });

  it("records oldValue and sets newValue=null when a tracked field is cleared to null", async () => {
    // Task currently has assignee set; PATCH clears it.
    const prevWithAssignee = { ...FULL_PREV_SNAPSHOT, assignee: "alice@example.com" };
    const updatedTask = { ...MOCK_TASK, assignee: null };
    mockState.updateResult = [updatedTask];
    mockState.selectQueue.push([prevWithAssignee]);
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);

    // assignee: null bypasses the assignee-validation guard (falsy check)
    await request(buildApp()).patch("/api/tasks/1").send({ assignee: null });

    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      field: "assignee",
      oldValue: "alice@example.com",
      newValue: null,
    });
  });

  it("emits one event per changed field when multiple fields change simultaneously", async () => {
    // Use "change" (valid enum value) not "change_request" which fails schema validation
    const updated = { ...MOCK_TASK, priority: "high", category: "change" };
    mockState.updateResult = [updated];
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ priority: "high", category: "change" });

    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "priority", oldValue: "medium", newValue: "high" }),
        expect.objectContaining({ field: "category", oldValue: "incident", newValue: "change" }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — custom field audit event emission
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id — custom field audit event emission", () => {
  const TEXT_FIELD_DEF = { id: 10, name: "Notes", type: "text", options: null, orgId: "test-org", deletedAt: null, position: 0, createdAt: "", updatedAt: "" };
  const SELECT_FIELD_DEF = { id: 12, name: "Environment", type: "single_select", options: ["prod", "staging"], orgId: "test-org", deletedAt: null, position: 2, createdAt: "", updatedAt: "" };
  const MULTI_SELECT_DEF = { id: 14, name: "Tags", type: "multi_select", options: ["bug", "feature", "hotfix"], orgId: "test-org", deletedAt: null, position: 4, createdAt: "", updatedAt: "" };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("emits a cf:<fieldName> event when a text custom field value changes", async () => {
    // prev customFields has { "10": "old note" }; PATCH sends "new note"
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);              // prev standard fields
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                  // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ customFields: { "10": "old note" } }]); // existing for merge
    mockState.selectQueue.push([]); // getOrgStages (after update)
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                  // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);                    // comment count
    // MOCK_TASK has no customFields → resolveCustomFieldNames skips DB call

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "10": "new note" } });

    // No standard-field changes → insertChangeEvents inserts nothing
    // Custom-field changes → one separate insert batch for cf: events
    expect(mockState.insertCalls).toHaveLength(1);
    const cfEvents: any[] = mockState.insertCalls[0];
    expect(cfEvents).toHaveLength(1);
    expect(cfEvents[0]).toMatchObject({
      taskId: 1,
      orgId: "test-org",
      field: "cf:Notes",
      oldValue: "old note",
      newValue: "new note",
    });
  });

  it("emits a cf:<fieldName> event with newValue=null when a custom field is cleared", async () => {
    // Task had "10": "existing note"; PATCH sends null to clear it.
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                  // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ customFields: { "10": "existing note" } }]); // existing for merge
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([TEXT_FIELD_DEF]);                  // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "10": null } });

    expect(mockState.insertCalls).toHaveLength(1);
    const cfEvents: any[] = mockState.insertCalls[0];
    expect(cfEvents).toHaveLength(1);
    expect(cfEvents[0]).toMatchObject({
      field: "cf:Notes",
      oldValue: "existing note",
      newValue: null,
    });
  });

  it("emits no cf event when the custom field value is unchanged", async () => {
    // Sending the same value that's already stored → no diff → no event.
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ customFields: { "12": "prod" } }]); // existing for merge (same value)
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "12": "prod" } });

    // Neither standard fields nor custom fields changed → no inserts at all.
    expect(mockState.insertCalls).toHaveLength(0);
  });

  it("serializes multi-select array values as JSON strings in the event", async () => {
    // No prior value for field "14"; PATCH sets ["bug","feature"].
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ customFields: {} }]);            // existing (field not yet set)
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([MULTI_SELECT_DEF]);                // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ customFields: { "14": ["bug", "feature"] } });

    expect(mockState.insertCalls).toHaveLength(1);
    const cfEvents: any[] = mockState.insertCalls[0];
    expect(cfEvents).toHaveLength(1);
    expect(cfEvents[0]).toMatchObject({
      field: "cf:Tags",
      oldValue: null,
      newValue: JSON.stringify(["bug", "feature"]),
    });
  });

  it("emits both standard-field and cf events when both change in the same PATCH", async () => {
    // priority changes (medium → high) AND a custom field changes.
    const updatedTask = { ...MOCK_TASK, priority: "high" };
    mockState.updateResult = [updatedTask];
    mockState.selectQueue.push([FULL_PREV_SNAPSHOT]);
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                // validateAndSanitizeCustomFields
    mockState.selectQueue.push([{ customFields: { "12": "prod" } }]); // existing for merge
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([SELECT_FIELD_DEF]);                // name lookup for cf event
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .patch("/api/tasks/1")
      .send({ priority: "high", customFields: { "12": "staging" } });

    // Two separate db.insert().values() calls:
    // insertCalls[0] = standard field events batch (from insertChangeEvents)
    // insertCalls[1] = cf: events batch
    expect(mockState.insertCalls).toHaveLength(2);

    const standardEvents: any[] = mockState.insertCalls[0];
    expect(standardEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "priority", oldValue: "medium", newValue: "high" }),
      ]),
    );

    const cfEvents: any[] = mockState.insertCalls[1];
    expect(cfEvents).toHaveLength(1);
    expect(cfEvents[0]).toMatchObject({
      field: "cf:Environment",
      oldValue: "prod",
      newValue: "staging",
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks - description sanitization (markdown mode)
// ---------------------------------------------------------------------------

describe("POST /api/tasks - description sanitization", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("stores null when description is empty or whitespace-only", async () => {
    mockState.selectQueue.push([{ nextNum: 1 }]); // MAX(orgTaskNumber)
    mockState.selectQueue.push([{ count: 0 }]);   // comment count

    await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, description: "   \n  " });

    expect(mockState.insertCalls[0].description).toBeNull();
  });

  it("stores null when description is an empty string", async () => {
    mockState.selectQueue.push([{ nextNum: 1 }]);
    mockState.selectQueue.push([{ count: 0 }]);

    await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, description: "" });

    expect(mockState.insertCalls[0].description).toBeNull();
  });

  it("preserves markdown content as-is", async () => {
    mockState.selectQueue.push([{ nextNum: 1 }]);
    mockState.selectQueue.push([{ count: 0 }]);

    const md = "## Steps\n\n- [ ] Check logs\n- **Restart** the service";
    await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, description: md });

    expect(mockState.insertCalls[0].description).toBe(md);
  });

  it("preserves code blocks and inline code in markdown", async () => {
    mockState.selectQueue.push([{ nextNum: 1 }]);
    mockState.selectQueue.push([{ count: 0 }]);

    const md = "Run `kubectl get pods`\n\n```bash\nkubectl logs pod\n```";
    await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, description: md });

    expect(mockState.insertCalls[0].description).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/watchers
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/watchers", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.insertCalls = [];
  });

  it("returns count, isWatching and watchers array for an existing task", async () => {
    // 1. Task ownership check
    mockState.selectQueue.push([{ id: 1 }]);
    // 2. Watcher list join
    mockState.selectQueue.push([
      { userId: "user-owner", firstName: "Alice", lastName: "Smith", email: "alice@org.com", profileImageUrl: null },
    ]);

    const res = await request(buildApp()).get("/api/tasks/1/watchers");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    // The middleware sets req.user.id = "user-owner", so isWatching = true
    expect(res.body.isWatching).toBe(true);
    expect(res.body.watchers).toHaveLength(1);
    expect(res.body.watchers[0].userId).toBe("user-owner");
  });

  it("returns count=0 and isWatching=false when no one is watching", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // task found
    mockState.selectQueue.push([]);           // no watchers

    const res = await request(buildApp()).get("/api/tasks/1/watchers");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.isWatching).toBe(false);
    expect(res.body.watchers).toEqual([]);
  });

  it("returns 404 when task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not found in this org

    const res = await request(buildApp()).get("/api/tasks/999/watchers");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer task id", async () => {
    const res = await request(buildApp()).get("/api/tasks/bad-id/watchers");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/watch
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/watch", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.insertCalls = [];
  });

  it("returns { watching: true } for an existing task (idempotent upsert)", async () => {
    // Task ownership check — found
    mockState.selectQueue.push([{ id: 1 }]);

    const res = await request(buildApp()).post("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(res.body.watching).toBe(true);
  });

  it("returns 404 when task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not in this org

    const res = await request(buildApp()).post("/api/tasks/999/watch");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer task id", async () => {
    const res = await request(buildApp()).post("/api/tasks/not-a-number/watch");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id/watch
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id/watch", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.insertCalls = [];
  });

  it("returns { watching: false } after removing watch (idempotent)", async () => {
    // Task ownership check — found
    mockState.selectQueue.push([{ id: 1 }]);

    const res = await request(buildApp()).delete("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(res.body.watching).toBe(false);
  });

  it("returns 404 when task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not in this org

    const res = await request(buildApp()).delete("/api/tasks/999/watch");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer task id", async () => {
    const res = await request(buildApp()).delete("/api/tasks/not-a-number/watch");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 204 on successful delete", async () => {
    // Ownership check: select returns the task (belongs to org)
    mockState.selectQueue.push([{ id: 1 }]);

    const res = await request(buildApp()).delete("/api/tasks/1");

    expect(res.status).toBe(204);
  });

  it("returns 404 when the task does not exist", async () => {
    // Ownership check: select returns [] (not in this org)
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/tasks/999");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).delete("/api/tasks/bad-id");
    expect(res.status).toBe(400);
  });
});
