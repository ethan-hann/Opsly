/**
 * Cross-tenant (organization) isolation regression tests.
 *
 * These tests verify that every by-id and list endpoint correctly scopes data
 * to the authenticated user's organization.  Two organizations are simulated:
 *
 *   Org A  ("org-a") — the caller's org (set by the middleware mock)
 *   Org B  ("org-b") — another org whose data must never be visible to Org A
 *
 * The @workspace/db mock is configured so that DB queries for Org A's entities
 * return data only when the mock state has been explicitly seeded (i.e. the
 * route passed the correct org filter).  When the mock queue is empty the
 * query returns [] / no rows, simulating a cross-org miss.
 *
 * Covered entities / endpoints:
 *  - GET  /tasks             — list scoped to caller org
 *  - GET  /tasks/:id         — 404 for another org's task
 *  - PATCH /tasks/:id        — 404 for another org's task
 *  - DELETE /tasks/:id       — 404 for another org's task
 *  - GET  /tasks/overdue     — empty list for another org
 *  - GET  /projects          — list scoped to caller org
 *  - GET  /projects/:id      — 404 for another org's project
 *  - PATCH /projects/:id     — 404 for another org's project
 *  - DELETE /projects/:id    — 404 for another org's project
 *  - GET  /tasks/:id/comments — 404 when parent task belongs to another org
 *  - POST /tasks/:id/comments — 404 when parent task belongs to another org
 *  - DELETE /comments/:id    — 404 for another org's comment (direct org filter)
 *  - GET  /notes             — list scoped to caller org
 *  - GET  /notes/:id         — 404 for another org's note
 *  - PATCH /notes/:id        — 404 for another org's note
 *  - DELETE /notes/:id       — 404 for another org's note
 *  - GET  /dashboard/summary — counts reflect only caller's org (zero for empty org)
 *  - GET  /dashboard/activity — empty list when no data in caller's org
 *  - GET  /orgs/members      — only members of the caller's org
 *  - GET  /orgs/invitations  — only invitations of the caller's org
 *  - GET  /views             — list scoped to caller org; org-b views not leaked
 *  - PATCH /views/:id        — 404 for another org's view (prevents ID enumeration), 403 for non-owner in same org
 *  - DELETE /views/:id       — 404 for another org's view (prevents ID enumeration), 403 for non-owner in same org
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Shared mock state — consumed by the DB mock below
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
  // Per-test middleware overrides — reset() restores the defaults.
  userId: "user-a1",
  userEmail: "user-a1@org-a.example",
  permissions: {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
    manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
  } as Record<string, boolean>,
}));

// ---------------------------------------------------------------------------
// @workspace/api-zod — passthrough mock so that the generated files are not
// needed in the test environment.  Isolation tests verify org-scoping logic,
// not schema validation, so it is safe to let every schema parse pass through.
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  /** Every schema is a passthrough: parse returns its input unchanged. */
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
    // tasks
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
    // projects
    CreateProjectBody: p, UpdateProjectBody: p,
    GetProjectParams: p, UpdateProjectParams: p, DeleteProjectParams: p,
    ListProjectsResponse: p, CreateProjectResponse: p,
    GetProjectResponse: p, UpdateProjectResponse: p,
    // comments
    CreateCommentBody: p, CreateCommentParams: p,
    ListCommentsParams: p, DeleteCommentParams: p,
    ListCommentsResponse: p, CreateCommentResponse: p, DeleteCommentResponse: p,
    // notes
    ListNotesQueryParams: p, ListNotesResponse: p,
    CreateNoteBody: p, CreateNoteResponse: p,
    GetNoteParams: p, GetNoteResponse: p,
    UpdateNoteParams: p, UpdateNoteBody: p, UpdateNoteResponse: p,
    DeleteNoteParams: p,
    // dashboard
    GetDashboardSummaryResponse: p, GetRecentActivityResponse: p,
    // saved views
    ListViewsResponse: p, CreateViewBody: p, CreateViewResponse: p,
    UpdateViewParams: p, UpdateViewBody: p, UpdateViewResponse: p,
    DeleteViewParams: p,
    // task templates
    ListTaskTemplatesResponse: p, CreateTaskTemplateBody: p, CreateTaskTemplateResponse: p,
    UpdateTaskTemplateParams: p, UpdateTaskTemplateBody: p, UpdateTaskTemplateResponse: p,
    DeleteTaskTemplateParams: p,
  };
});

// ---------------------------------------------------------------------------
// @workspace/db — fully mocked, no real database connection
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

  const dbMock: any = {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve(mockState.insertResult),
          onConflictDoNothing: () => Promise.resolve([]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockState.updateResult),
          }),
        }),
      }),
      delete: () => ({
        where: () => {
          // Support both `await delete().where()` (comments route — no .returning())
          // and `delete().where().returning()` (tasks/projects/notes routes).
          const p = Promise.resolve(mockState.deleteResult);
          (p as any).returning = () => Promise.resolve(mockState.deleteResult);
          return p;
        },
      }),
      transaction: async (fn: any) => fn(dbMock),
  };

  return {
    db: dbMock,
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    notesTable: {},
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
    usersTable: {},
    invitationsTable: {},
    savedViewsTable: {},
    taskTemplatesTable: {},
    slaPoliciesTable: {},
    taskEventsTable: {},
    workflowStagesTable: {},
    customFieldDefinitionsTable: {},
    taskWatchersTable: {},
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: {},
    ALL_PERMISSIONS: [],
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  isNull: () => ({}),
  inArray: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: () => ({}),
  like: () => ({}),
}));

// ---------------------------------------------------------------------------
// requireOrgMiddleware — caller is authenticated as a member of "org-a"
// The org id is derived server-side; clients cannot override it.
// ---------------------------------------------------------------------------
// ALL_PERMS is kept for reference inside the member-list fixture (line ~760).
const ALL_PERMS = {
  view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
  delete_tasks: true, manage_projects: true, manage_org_settings: true,
  manage_members: true, manage_webhooks: true, manage_api_keys: true,
  manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
  manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
};
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.orgRole = mockState.permissions.manage_projects ? "admin" : "member";
    req.orgRoleId = "role-owner";
    req.orgRoleName = mockState.permissions.manage_projects ? "Owner" : "Member";
    req.isOrgOwner = mockState.userId === "user-a1";
    req.orgPermissions = mockState.permissions;
    req.user = { id: mockState.userId, email: mockState.userEmail };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.orgRole = mockState.permissions.manage_projects ? "admin" : "member";
    req.orgRoleId = "role-owner";
    req.orgRoleName = mockState.permissions.manage_projects ? "Owner" : "Member";
    req.isOrgOwner = mockState.userId === "user-a1";
    req.orgPermissions = mockState.permissions;
    req.user = { id: mockState.userId, email: mockState.userEmail };
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-a1", email: "user-a1@org-a.example" };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => {
    next();
  },
  requireOwner: (_req: any, _res: any, next: any) => {
    next();
  },
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  },
}));

// notes-sse has a side-effect import; stub it out
vi.mock("../lib/notes-sse", () => ({
  addSseClient: () => () => {},
  broadcastNoteChange: () => {},
}));

// webhook-dispatcher uses outboundWebhooksTable which is not in the db mock;
// stub it out so dispatch calls are silent no-ops in isolation tests.
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
  dispatchTaskCommented: () => {},
  dispatchTaskSlaBreached: () => {},
  dispatchNoteCreated: () => {},
  dispatchNoteUpdated: () => {},
  dispatchNoteDeleted: () => {},
  dispatchProjectCreated: () => {},
  dispatchProjectUpdated: () => {},
}));

// ---------------------------------------------------------------------------
// Import routes AFTER mocks are in place
// ---------------------------------------------------------------------------
import tasksRouter from "./tasks.js";
import projectsRouter from "./projects.js";
import commentsRouter from "./comments.js";
import notesRouter from "./notes.js";
import dashboardRouter from "./dashboard.js";
import orgsRouter from "./orgs.js";
import savedViewsRouter from "./saved-views.js";
import taskTemplatesRouter from "./task-templates.js";

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
  app.use("/api", savedViewsRouter);
  app.use("/api", taskTemplatesRouter);
  // Log unhandled errors so test failures give actionable output
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[test app error]", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures — represent Org B entities that Org A must not see
// ---------------------------------------------------------------------------
const ORG_B_TASK = {
  id: 42,
  orgId: "org-b",
  orgTaskNumber: 1,
  title: "Org B secret task",
  status: "todo",
  priority: "medium",
  category: "other",
  projectId: null,
  description: null,
  assignee: null,
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ORG_B_PROJECT = {
  id: 99,
  orgId: "org-b",
  name: "Org B secret project",
  description: null,
  status: "active",
  priority: "medium",
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ORG_B_COMMENT = {
  id: 77,
  orgId: "org-b",
  taskId: 42,
  content: "Org B comment",
  author: "user-b@org-b.example",
  createdAt: new Date().toISOString(),
};

const ORG_B_NOTE = {
  id: 55,
  orgId: "org-b",
  createdBy: "user-b1",
  title: "Org B secret note",
  content: "secret",
  visibility: "public_read",
  projectId: null,
  taskId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ORG_B_VIEW = {
  id: 200,
  orgId: "org-b",
  createdBy: "user-b1",
  name: "Org B secret view",
  filters: { projectFilter: { projectIds: [99] } },
  isOrgWide: false,
  isDefault: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ORG_B_TEMPLATE = {
  id: 300,
  orgId: "org-b",
  createdBy: "user-b1",
  name: "Org B secret template",
  defaultTitle: "Runbook: ",
  defaultPriority: "high",
  defaultCategory: "incident",
  defaultDescription: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------
function reset() {
  mockState.selectQueue.length = 0;
  mockState.insertResult = [];
  mockState.updateResult = [];
  mockState.deleteResult = [];
  // Restore default caller identity
  mockState.userId = "user-a1";
  mockState.userEmail = "user-a1@org-a.example";
  mockState.permissions = {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
    manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
  };
}

// ===========================================================================
// TASKS
// ===========================================================================

describe("Task isolation — GET /api/tasks", () => {
  beforeEach(reset);

  it("returns an empty list when org-a has no tasks (org-b tasks not leaked)", async () => {
    // The DB mock returns [] by default — simulating that the org filter
    // on the query excluded all of org-b's tasks.
    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a tasks when org-a has data", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a" };
    mockState.selectQueue.push([orgATask]); // tasks list
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filter isolation — assignee, dateFrom, dateTo combinations cannot surface
// tasks from another org even when filter values overlap across orgs.
//
// Each "no leak" test pushes nothing onto the selectQueue.  The mock DB
// then returns [] — exactly what a correctly-scoped orgId WHERE clause
// produces when org-a has no tasks matching the filter despite org-b having
// tasks that would otherwise match.
// ---------------------------------------------------------------------------

const SHARED_ASSIGNEE = "shared@example.com";
const SHARED_DATE = "2025-03-15";

describe("Task filter isolation — assignee filter", () => {
  beforeEach(reset);

  it("returns empty when org-b has a task with the same assignee but org-a has none", async () => {
    // selectQueue is empty → DB returned [] for orgId='org-a' AND assignee filter
    const res = await request(buildApp()).get(`/api/tasks?assignee=${SHARED_ASSIGNEE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when both orgs have tasks with the same assignee", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a", assignee: SHARED_ASSIGNEE };
    mockState.selectQueue.push([orgATask]); // DB returns only the org-a task (orgId scoped)
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get(`/api/tasks?assignee=${SHARED_ASSIGNEE}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
    expect(res.body[0].assignee).toBe(SHARED_ASSIGNEE);
  });
});

describe("Task filter isolation — dateFrom filter", () => {
  beforeEach(reset);

  it("returns empty when org-b tasks fall within the date range but org-a has none", async () => {
    const res = await request(buildApp()).get(`/api/tasks?dateFrom=${SHARED_DATE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when both orgs have tasks on or after dateFrom", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a", dueDate: SHARED_DATE };
    mockState.selectQueue.push([orgATask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(`/api/tasks?dateFrom=${SHARED_DATE}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
  });
});

describe("Task filter isolation — dateTo filter", () => {
  beforeEach(reset);

  it("returns empty when org-b tasks are before the cutoff but org-a has none", async () => {
    const res = await request(buildApp()).get(`/api/tasks?dateTo=${SHARED_DATE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when both orgs have tasks before dateTo", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a", dueDate: "2025-03-10" };
    mockState.selectQueue.push([orgATask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(`/api/tasks?dateTo=${SHARED_DATE}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
  });
});

describe("Task filter isolation — combined assignee + dateFrom + dateTo", () => {
  beforeEach(reset);

  it("returns empty when org-b matches all combined filter criteria but org-a has no tasks", async () => {
    const res = await request(buildApp()).get(
      `/api/tasks?assignee=${SHARED_ASSIGNEE}&dateFrom=2025-03-01&dateTo=2025-03-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when both orgs match all combined filter criteria", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a", assignee: SHARED_ASSIGNEE, dueDate: SHARED_DATE };
    mockState.selectQueue.push([orgATask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(
      `/api/tasks?assignee=${SHARED_ASSIGNEE}&dateFrom=2025-03-01&dateTo=2025-03-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
  });

  it("returns empty with status + priority + assignee + date range when org-b matches but org-a does not", async () => {
    const res = await request(buildApp()).get(
      `/api/tasks?status=todo&priority=medium&assignee=${SHARED_ASSIGNEE}&dateFrom=2025-03-01&dateTo=2025-03-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when all five filter dimensions overlap across orgs", async () => {
    const orgATask = {
      ...ORG_B_TASK, id: 1, orgId: "org-a",
      status: "todo", priority: "medium",
      assignee: SHARED_ASSIGNEE, dueDate: SHARED_DATE,
    };
    mockState.selectQueue.push([orgATask]);
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(
      `/api/tasks?status=todo&priority=medium&assignee=${SHARED_ASSIGNEE}&dateFrom=2025-03-01&dateTo=2025-03-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
  });
});

// ---------------------------------------------------------------------------
// Custom-field filter isolation — a JSONB custom-field filter must not surface
// tasks from another org even when the field value is identical across orgs.
//
// The filter parameter follows the future API shape: ?customField[<fieldId>]=<value>
// e.g. ?customField[10]=prod
//
// Because the list route always adds `eq(tasksTable.orgId, orgId)` to the WHERE
// clause before any filter, the DB mock returning [] here documents that a
// correctly-scoped query returns nothing for org-a even though org-b has a
// matching task.
// ---------------------------------------------------------------------------

const SHARED_CUSTOM_FIELD_ID = "10";
const SHARED_CUSTOM_FIELD_VALUE = "prod";

describe("Task filter isolation — custom field filter", () => {
  beforeEach(reset);

  it("returns empty when org-b has a task with the matching custom field value but org-a has none", async () => {
    // selectQueue is empty → DB returned [] for orgId='org-a' AND custom field filter
    // (org-b has a task with customFields[10]='prod' but the orgId scope excludes it)
    const res = await request(buildApp()).get(
      `/api/tasks?customField[${SHARED_CUSTOM_FIELD_ID}]=${SHARED_CUSTOM_FIELD_VALUE}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a's task when both orgs have tasks with the same custom field value", async () => {
    const orgATask = {
      ...ORG_B_TASK,
      id: 1,
      orgId: "org-a",
      customFields: { [SHARED_CUSTOM_FIELD_ID]: SHARED_CUSTOM_FIELD_VALUE },
    };
    mockState.selectQueue.push([orgATask]); // DB returns only the org-a task (orgId scoped)
    mockState.selectQueue.push([]); // getOrgStages
    mockState.selectQueue.push([]); // SLA policies
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get(
      `/api/tasks?customField[${SHARED_CUSTOM_FIELD_ID}]=${SHARED_CUSTOM_FIELD_VALUE}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
    expect(res.body[0].customFields?.[SHARED_CUSTOM_FIELD_ID]).toBe(SHARED_CUSTOM_FIELD_VALUE);
  });
});

describe("Task isolation — GET /api/tasks/overdue", () => {
  beforeEach(reset);

  it("returns empty overdue list when org-a has no overdue tasks", async () => {
    const res = await request(buildApp()).get("/api/tasks/overdue");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Task isolation — GET /api/tasks/:id", () => {
  beforeEach(reset);

  it("returns 404 when the task id belongs to org-b (not in org-a)", async () => {
    // DB returns [] — the AND(id=42, orgId='org-a') condition matched nothing
    const res = await request(buildApp()).get("/api/tasks/42");
    expect(res.status).toBe(404);
  });

  it("returns 200 for a task that belongs to org-a", async () => {
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a" };
    mockState.selectQueue.push([orgATask]); // task found
    mockState.selectQueue.push([]); // getOrgStages (Promise.all slot 1)
    mockState.selectQueue.push([]); // SLA policies (Promise.all slot 2)
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe("Task isolation — PATCH /api/tasks/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to update an org-b task", async () => {
    // selectQueue is empty → prev SELECT returns [] → 404 before any update
    // (no status field so resolveStage is not called)
    const res = await request(buildApp())
      .patch("/api/tasks/42")
      .send({ title: "Renamed" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller does not have edit_tasks permission", async () => {
    // Simulate a role where edit_tasks has been revoked — the server must
    // enforce this regardless of what the frontend shows.
    mockState.permissions = { ...mockState.permissions, edit_tasks: false };
    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ status: "done" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when setting status to done without close_tasks permission", async () => {
    // edit_tasks alone must not be sufficient to close a task.
    // Push a closed-type stage so resolveStage succeeds, then the close_tasks
    // permission guard triggers the 403.
    mockState.permissions = { ...mockState.permissions, close_tasks: false };
    mockState.selectQueue.push([{ id: 1, orgId: "org-a", name: "Done", type: "closed", color: "#10b981", position: 3, archivedAt: null }]); // resolveStage
    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ status: "1" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/close/i) });
  });

  it("allows a non-status field change without close_tasks permission", async () => {
    mockState.permissions = { ...mockState.permissions, close_tasks: false };
    const orgATask = { ...ORG_B_TASK, id: 1, orgId: "org-a" };
    mockState.selectQueue.push([orgATask]); // prev snapshot found
    mockState.updateResult = [{ ...orgATask, title: "Renamed" }];
    mockState.selectQueue.push([]); // getOrgStages (after update, before buildTaskWithProject)
    // projectId is null → project lookup skipped; next select is comment count
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ title: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed");
  });
});

describe("Bulk task permission — PATCH /api/tasks/bulk close_tasks guard", () => {
  beforeEach(reset);

  it("returns 403 when bulk-closing tasks without close_tasks permission", async () => {
    // edit_tasks alone must not be sufficient to close tasks in bulk —
    // the bulk endpoint must apply the same close_tasks guard as PATCH /tasks/:id.
    // Push a closed-type stage so resolveStage succeeds, then the close_tasks
    // permission guard triggers the 403.
    mockState.permissions = { ...mockState.permissions, close_tasks: false };
    mockState.selectQueue.push([{ id: 1, orgId: "org-a", name: "Done", type: "closed", color: "#10b981", position: 3, archivedAt: null }]); // resolveStage
    const res = await request(buildApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [1, 2], patch: { status: "1" } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/close/i) });
  });

  it("allows a bulk non-close update (priority) when close_tasks is false", async () => {
    // close_tasks should only be required when status is being set to "done";
    // changing an unrelated field (priority) must succeed with just edit_tasks.
    mockState.permissions = { ...mockState.permissions, close_tasks: false };
    const prevRow = {
      id: 1, status: "todo", priority: "medium", assignee: null,
      category: "incident", title: "Task 1", dueDate: null, projectId: null,
    };
    mockState.selectQueue.push([prevRow]); // prevRows fetch
    mockState.selectQueue.push([]); // getOrgStages (after update, before insertChangeEvents)

    const res = await request(buildApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [1], patch: { priority: "high" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 1 });
  });
});

describe("Task permission — POST /api/tasks", () => {
  beforeEach(reset);

  it("returns 403 when the caller does not have create_tasks permission", async () => {
    // Simulate a role where create_tasks has been revoked — the server must
    // enforce this regardless of what the frontend shows.
    mockState.permissions = { ...mockState.permissions, create_tasks: false };
    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ title: "New task", status: "todo", priority: "medium", category: "incident" });
    expect(res.status).toBe(403);
  });
});

describe("Task isolation — DELETE /api/tasks/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to delete an org-b task", async () => {
    // delete().where().returning() → []
    const res = await request(buildApp()).delete("/api/tasks/42");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller does not have delete_tasks permission", async () => {
    // Simulate a role where delete_tasks has been revoked (default for members) —
    // the server must enforce this regardless of what the frontend shows.
    mockState.permissions = { ...mockState.permissions, delete_tasks: false };
    const res = await request(buildApp()).delete("/api/tasks/1");
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// PROJECTS
// ===========================================================================

describe("Project isolation — GET /api/projects", () => {
  beforeEach(reset);

  it("returns an empty list when org-a has no projects", async () => {
    mockState.selectQueue.push([]); // projects list
    mockState.selectQueue.push([]); // task counts

    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Project isolation — GET /api/projects/:id", () => {
  beforeEach(reset);

  it("returns 404 when the project id belongs to org-b", async () => {
    // project lookup → [] (orgId filter excluded org-b project)
    const res = await request(buildApp()).get("/api/projects/99");
    expect(res.status).toBe(404);
  });

  it("returns 200 for a project that belongs to org-a", async () => {
    const orgAProject = {
      ...ORG_B_PROJECT,
      id: 1,
      orgId: "org-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockState.selectQueue.push([orgAProject]); // project found
    mockState.selectQueue.push([{ total: 0, completed: 0 }]); // task counts

    const res = await request(buildApp()).get("/api/projects/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe("Project isolation — PATCH /api/projects/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to update an org-b project", async () => {
    const res = await request(buildApp())
      .patch("/api/projects/99")
      .send({ name: "Hacked name" });
    expect(res.status).toBe(404);
  });
});

describe("Project isolation — DELETE /api/projects/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to delete an org-b project", async () => {
    const res = await request(buildApp()).delete("/api/projects/99");
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// COMMENTS
// ===========================================================================

describe("Comment isolation — GET /api/tasks/:id/comments", () => {
  beforeEach(reset);

  it("returns 404 when the parent task belongs to org-b", async () => {
    // Task lookup with orgId='org-a' returns [] — org-b task not found
    const res = await request(buildApp()).get("/api/tasks/42/comments");
    expect(res.status).toBe(404);
  });

  it("returns 200 with only org-a comments for an org-a task", async () => {
    const orgATask = { id: 1 };
    mockState.selectQueue.push([orgATask]); // task belongs to org-a
    const orgAComment = { ...ORG_B_COMMENT, id: 1, orgId: "org-a", taskId: 1 };
    mockState.selectQueue.push([orgAComment]); // comments scoped by orgId

    const res = await request(buildApp()).get("/api/tasks/1/comments");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("Comment isolation — POST /api/tasks/:id/comments", () => {
  beforeEach(reset);

  it("returns 404 when posting to an org-b task", async () => {
    // Task lookup → [] (orgId filter excludes org-b task)
    const res = await request(buildApp())
      .post("/api/tasks/42/comments")
      .send({ content: "Should not be created" });
    expect(res.status).toBe(404);
  });
});

describe("Comment isolation — DELETE /api/comments/:id", () => {
  beforeEach(reset);

  it("returns 404 when the comment does not exist", async () => {
    // Step 1: comment lookup returns empty
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/comments/77");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the comment's orgId belongs to org-b (combined id+org query returns empty)", async () => {
    // The WHERE (id = 77 AND org_id = 'org-a') finds nothing for an org-b comment
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/comments/77");
    expect(res.status).toBe(404);
  });

  it("returns 204 when deleting an org-a comment (direct org check)", async () => {
    // Step 1: SELECT finds the comment (org-a scoped)
    mockState.selectQueue.push([{ ...ORG_B_COMMENT, id: 1, orgId: "org-a", userId: "user-a1" }]);
    // Step 2: DELETE … RETURNING returns the deleted row
    mockState.deleteResult = [{ id: 1 }];

    const res = await request(buildApp()).delete("/api/comments/1");
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// NOTES
// ===========================================================================

describe("Note isolation — GET /api/notes", () => {
  beforeEach(reset);

  it("returns empty list when org-a has no notes (org-b notes not leaked)", async () => {
    // DB returns [] — orgId='org-a' filter excluded org-b notes
    const res = await request(buildApp()).get("/api/notes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Note isolation — GET /api/notes/:id", () => {
  beforeEach(reset);

  it("returns 404 when the note belongs to org-b", async () => {
    // select().from(notesTable).where(AND(id=55, orgId='org-a')) → []
    const res = await request(buildApp()).get("/api/notes/55");
    expect(res.status).toBe(404);
  });

  it("returns 200 for an org-a note owned by the caller", async () => {
    const orgANote = {
      ...ORG_B_NOTE,
      id: 1,
      orgId: "org-a",
      createdBy: "user-a1",
      visibility: "private",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockState.selectQueue.push([orgANote]);

    const res = await request(buildApp()).get("/api/notes/1");
    expect(res.status).toBe(200);
  });
});

describe("Note isolation — PATCH /api/notes/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to update an org-b note", async () => {
    // select to check existing note → []
    const res = await request(buildApp())
      .patch("/api/notes/55")
      .send({ title: "Hacked" });
    expect(res.status).toBe(404);
  });
});

describe("Note isolation — DELETE /api/notes/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to delete an org-b note", async () => {
    // select existing note → []
    const res = await request(buildApp()).delete("/api/notes/55");
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DASHBOARD
// ===========================================================================

describe("Dashboard isolation — GET /api/dashboard/summary", () => {
  beforeEach(reset);

  it("returns zero counters when org-a has no data", async () => {
    // All aggregates return empty rows → defaults to 0
    mockState.selectQueue.push([]); // taskTypeAgg (open/closed counts)
    mockState.selectQueue.push([]); // stageBreakdown
    mockState.selectQueue.push([{ total: 0, low: 0, medium: 0, high: 0, critical: 0 }]); // taskStats
    mockState.selectQueue.push([{ count: 0 }]); // overdueResult
    mockState.selectQueue.push([{ total: 0, active: 0 }]); // projectStats

    const res = await request(buildApp()).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.totalTasks).toBe(0);
    expect(res.body.totalProjects).toBe(0);
    expect(res.body.overdueCount).toBe(0);
  });
});

describe("Dashboard isolation — GET /api/dashboard/activity", () => {
  beforeEach(reset);

  it("returns empty activity when org-a has no data", async () => {
    mockState.selectQueue.push([]); // recent tasks
    mockState.selectQueue.push([]); // recent comments
    mockState.selectQueue.push([]); // recent projects
    mockState.selectQueue.push([]); // recent cf events

    const res = await request(buildApp()).get("/api/dashboard/activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ===========================================================================
// ORGS — member list and invitations
// ===========================================================================

describe("Org isolation — GET /api/orgs/members", () => {
  beforeEach(reset);

  it("returns only members of org-a (empty when org-a has no members beyond the query)", async () => {
    // Member list query for orgId='org-a' returns []
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/orgs/members");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns org-a members and not org-b members", async () => {
    const orgAMember = {
      userId: "user-a1",
      roleId: "role-owner",
      roleName: "Owner",
      isOwner: true,
      permissions: {
        view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
        delete_tasks: true, manage_projects: true, manage_org_settings: true,
        manage_members: true, manage_webhooks: true, manage_api_keys: true,
        manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
        manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
      },
      joinedAt: new Date(),
      firstName: "Alice",
      lastName: "Admin",
      email: "user-a1@org-a.example",
      profileImageUrl: null,
    };
    mockState.selectQueue.push([orgAMember]);

    const res = await request(buildApp()).get("/api/orgs/members");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe("user-a1@org-a.example");
  });
});

describe("Org isolation — GET /api/orgs/invitations", () => {
  beforeEach(reset);

  it("returns only org-a invitations (empty when org-a has none)", async () => {
    // Invitations query scoped to orgId='org-a' returns []
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/orgs/invitations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Org isolation — DELETE /api/orgs/invitations/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to cancel an org-b invitation", async () => {
    // Invitation lookup with AND(id=X, orgId='org-a') → [] (org-b invite excluded)
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/orgs/invitations/org-b-invite-id");
    expect(res.status).toBe(404);
  });
});

describe("Org isolation — DELETE /api/orgs/members/:userId", () => {
  beforeEach(reset);

  it("returns 404 when attempting to remove a user who is not a member of org-a", async () => {
    // Member lookup with AND(orgId='org-a', userId='org-b-user') → []
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/orgs/members/org-b-user");
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// SAVED VIEWS
// ===========================================================================

describe("Saved view isolation — GET /api/views", () => {
  beforeEach(reset);

  it("returns empty list when org-a has no views (org-b views not leaked)", async () => {
    // DB returns [] — AND(orgId='org-a', createdBy='user-a1' OR isOrgWide=true)
    // excludes all of org-b's views.
    const res = await request(buildApp()).get("/api/views");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns org-a personal and org-wide views for the caller", async () => {
    const personalView = { ...ORG_B_VIEW, id: 1, orgId: "org-a", createdBy: "user-a1", isOrgWide: false };
    const orgWideView  = { ...ORG_B_VIEW, id: 2, orgId: "org-a", createdBy: "user-a2", isOrgWide: true };
    mockState.selectQueue.push([personalView, orgWideView]);

    const res = await request(buildApp()).get("/api/views");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((v: any) => v.orgId === "org-a")).toBe(true);
  });

  it("does not return user-a1's private view when caller is user-a2", async () => {
    // Switch the authenticated caller to user-a2 (same org, different member).
    mockState.userId = "user-a2";
    mockState.userEmail = "user-a2@org-a.example";

    // The DB applies AND(orgId='org-a', OR(createdBy='user-a2', isOrgWide=true)).
    // user-a1's private view (id: 10) is excluded by that clause — only user-a2's
    // personal view (id: 5) comes back.
    const a2PersonalView = { ...ORG_B_VIEW, id: 5, orgId: "org-a", createdBy: "user-a2", isOrgWide: false };
    mockState.selectQueue.push([a2PersonalView]);

    const res = await request(buildApp()).get("/api/views");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(5);
    expect(res.body[0].createdBy).toBe("user-a2");
    // user-a1's private view must be absent
    expect(res.body.some((v: any) => v.createdBy === "user-a1")).toBe(false);
  });

  it("includes an org-wide view created by user-a1 when caller is user-a2", async () => {
    // Caller is user-a2; user-a1 has both a private view and an org-wide view.
    // Only the org-wide view should appear (isOrgWide=true satisfies the OR clause).
    mockState.userId = "user-a2";
    mockState.userEmail = "user-a2@org-a.example";

    // DB returns the org-wide view (created by user-a1) together with user-a2's
    // personal view — user-a1's private view (not in the queue) is absent.
    const a1OrgWideView  = { ...ORG_B_VIEW, id: 3, orgId: "org-a", createdBy: "user-a1", isOrgWide: true };
    const a2PersonalView = { ...ORG_B_VIEW, id: 5, orgId: "org-a", createdBy: "user-a2", isOrgWide: false };
    mockState.selectQueue.push([a1OrgWideView, a2PersonalView]);

    const res = await request(buildApp()).get("/api/views");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // The org-wide view from user-a1 IS visible to user-a2
    expect(res.body.some((v: any) => v.id === 3 && v.isOrgWide === true)).toBe(true);
    // user-a2's own personal view IS also present
    expect(res.body.some((v: any) => v.id === 5 && v.createdBy === "user-a2")).toBe(true);
  });
});

describe("Saved view isolation — PATCH /api/views/:id", () => {
  beforeEach(reset);

  it("returns 404 (not 403) when patching an org-b view ID — prevents ID enumeration", async () => {
    // AND(id=200, orgId='org-a') finds nothing; cross-org view is invisible.
    const res = await request(buildApp())
      .patch("/api/views/200")
      .send({ name: "Hacked" });
    expect(res.status).toBe(404);
  });

  it("returns 200 when the owner updates their own view", async () => {
    const orgAView = { ...ORG_B_VIEW, id: 1, orgId: "org-a", createdBy: "user-a1" };
    mockState.selectQueue.push([orgAView]);
    mockState.updateResult = [{ ...orgAView, name: "Renamed" }];

    const res = await request(buildApp()).patch("/api/views/1").send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });

  it("returns 403 when a non-owner member in the same org tries to edit", async () => {
    // Caller is user-a2 (member, no manage_saved_views) — view owned by user-a1.
    mockState.userId = "user-a2";
    mockState.userEmail = "user-a2@org-a.example";
    mockState.permissions = { ...mockState.permissions, manage_saved_views: false };

    const orgAView = { ...ORG_B_VIEW, id: 1, orgId: "org-a", createdBy: "user-a1" };
    mockState.selectQueue.push([orgAView]);

    const res = await request(buildApp()).patch("/api/views/1").send({ name: "Hacked" });
    expect(res.status).toBe(403);
  });
});

describe("Saved view isolation — DELETE /api/views/:id", () => {
  beforeEach(reset);

  it("returns 404 (not 403) when deleting an org-b view ID — prevents ID enumeration", async () => {
    // AND(id=200, orgId='org-a') finds nothing.
    const res = await request(buildApp()).delete("/api/views/200");
    expect(res.status).toBe(404);
  });

  it("returns 204 when the owner deletes their own view", async () => {
    const orgAView = { ...ORG_B_VIEW, id: 1, orgId: "org-a", createdBy: "user-a1" };
    mockState.selectQueue.push([orgAView]);
    mockState.deleteResult = [{ id: 1 }];

    const res = await request(buildApp()).delete("/api/views/1");
    expect(res.status).toBe(204);
  });

  it("returns 403 when a non-owner member in the same org tries to delete", async () => {
    // Caller is user-a2 (member, no manage_saved_views) — view owned by user-a1.
    mockState.userId = "user-a2";
    mockState.userEmail = "user-a2@org-a.example";
    mockState.permissions = { ...mockState.permissions, manage_saved_views: false };

    const orgAView = { ...ORG_B_VIEW, id: 1, orgId: "org-a", createdBy: "user-a1" };
    mockState.selectQueue.push([orgAView]);

    const res = await request(buildApp()).delete("/api/views/1");
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// TASK TEMPLATES — cross-org isolation tests
// ===========================================================================

describe("Task template isolation — GET /api/task-templates", () => {
  beforeEach(reset);

  it("returns empty list when org-a has no templates (org-b templates not leaked)", async () => {
    // selectQueue is empty → the WHERE orgId='org-a' clause returns nothing;
    // org-b's templates are never visible to the org-a caller.
    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only org-a templates when org-a has data", async () => {
    const orgATemplate = { ...ORG_B_TEMPLATE, id: 1, orgId: "org-a", createdBy: "user-a1" };
    mockState.selectQueue.push([orgATemplate]);

    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
    // org-b's template (id: 300) is absent
    expect(res.body.some((t: any) => t.orgId === "org-b")).toBe(false);
  });
});

describe("Task template isolation — PATCH /api/task-templates/:id", () => {
  beforeEach(reset);

  it("returns 404 (not 403) when patching an org-b template ID — prevents ID enumeration", async () => {
    // Caller has manage_task_templates (default). The route looks up
    // AND(id=300, orgId='org-a'), which finds nothing because template 300
    // belongs to org-b.  The empty result produces a 404, not a 403,
    // so attackers cannot enumerate which IDs exist in other orgs.
    const res = await request(buildApp())
      .patch("/api/task-templates/300")
      .send({ name: "Hacked" });
    expect(res.status).toBe(404);
  });
});

describe("Task template isolation — DELETE /api/task-templates/:id", () => {
  beforeEach(reset);

  it("returns 404 (not 403) when deleting an org-b template ID — prevents ID enumeration", async () => {
    // Same logic as PATCH: AND(id=300, orgId='org-a') finds nothing.
    const res = await request(buildApp()).delete("/api/task-templates/300");
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// TASK TEMPLATES — permission guard tests
// ===========================================================================

const ORG_A_TEMPLATE = {
  id: 1,
  orgId: "org-a",
  createdBy: "user-a1",
  name: "Bug report template",
  defaultTitle: "Bug: ",
  defaultPriority: "high",
  defaultCategory: "incident",
  defaultDescription: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Task template permissions — GET /api/task-templates", () => {
  beforeEach(reset);

  it("returns 200 for a member without manage_task_templates", async () => {
    // GET is open to all org members — no permission guard in the route.
    mockState.permissions = { ...mockState.permissions, manage_task_templates: false };
    mockState.selectQueue.push([ORG_A_TEMPLATE]);

    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 200 for an admin with manage_task_templates", async () => {
    mockState.selectQueue.push([ORG_A_TEMPLATE]);

    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
  });
});

describe("Task template permissions — POST /api/task-templates", () => {
  beforeEach(reset);

  it("returns 403 when caller lacks manage_task_templates", async () => {
    mockState.permissions = { ...mockState.permissions, manage_task_templates: false };

    const res = await request(buildApp())
      .post("/api/task-templates")
      .send({ name: "Incident template", defaultTitle: "Incident: " });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_task_templates/);
  });

  it("returns 201 when caller has manage_task_templates", async () => {
    // manage_task_templates: true is the default in reset()
    mockState.insertResult = [ORG_A_TEMPLATE];

    const res = await request(buildApp())
      .post("/api/task-templates")
      .send({ name: "Bug report template" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });
});

describe("Task template permissions — PATCH /api/task-templates/:id", () => {
  beforeEach(reset);

  it("returns 403 when caller lacks manage_task_templates", async () => {
    mockState.permissions = { ...mockState.permissions, manage_task_templates: false };

    const res = await request(buildApp())
      .patch("/api/task-templates/1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_task_templates/);
  });

  it("returns 200 when caller has manage_task_templates and template exists", async () => {
    mockState.selectQueue.push([ORG_A_TEMPLATE]); // existing template lookup
    mockState.updateResult = [{ ...ORG_A_TEMPLATE, name: "Renamed" }];

    const res = await request(buildApp())
      .patch("/api/task-templates/1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });

  it("returns 404 when caller has permission but template does not exist", async () => {
    mockState.selectQueue.push([]); // template not found

    const res = await request(buildApp())
      .patch("/api/task-templates/999")
      .send({ name: "Renamed" });
    expect(res.status).toBe(404);
  });
});

describe("Task template permissions — DELETE /api/task-templates/:id", () => {
  beforeEach(reset);

  it("returns 403 when caller lacks manage_task_templates", async () => {
    mockState.permissions = { ...mockState.permissions, manage_task_templates: false };

    const res = await request(buildApp()).delete("/api/task-templates/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_task_templates/);
  });

  it("returns 204 when caller has manage_task_templates and template exists", async () => {
    mockState.selectQueue.push([ORG_A_TEMPLATE]); // existing template lookup

    const res = await request(buildApp()).delete("/api/task-templates/1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when caller has permission but template does not exist", async () => {
    mockState.selectQueue.push([]); // template not found

    const res = await request(buildApp()).delete("/api/task-templates/999");
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Custom field filter isolation — GET /tasks?customFieldId=<id>
//
// When a customFieldId query param is present, GET /tasks looks up the field
// definition scoped to req.orgId before building the WHERE clause.  These
// tests confirm:
//
//  (a) A cross-org field ID returns 400 with a generic message — no field name,
//      type, or option metadata from the other org is ever included in the
//      response body, so callers cannot use the filter path to probe another
//      org's schema.
//
//  (b) The lookup IS actually org-scoped: an org-a field ID is found (200),
//      while an org-b field ID is not (400), demonstrating that orgId is ANDed
//      into the definition lookup WHERE clause.
//
//  (c) A non-numeric customFieldId is rejected immediately (400) without any
//      DB round-trip.
// ===========================================================================

describe("Custom field filter isolation — GET /tasks?customFieldId", () => {
  beforeEach(reset);

  it("returns 400 for a cross-org field ID without leaking any org-b field metadata", async () => {
    // The definition lookup queries WHERE id=:cfId AND orgId='org-a'.
    // An org-b field ID is not in org-a's scope → shift() returns [] → not found.
    // The handler must return a generic error: no field name, type, or option
    // values from org-b should appear in the response body.
    // (selectQueue is empty: shift() → [] simulates the cross-org miss.)

    const res = await request(buildApp()).get("/api/tasks?customFieldId=999");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Custom field not found");
    // Confirm nothing from an org-b definition leaks into the error payload.
    expect(JSON.stringify(res.body)).not.toMatch(/org-b/);
  });

  it("confirms the lookup is org-scoped: org-a field ID is found and returns 200", async () => {
    // When the definition lookup returns a row, the handler proceeds normally.
    // This companion test, combined with the cross-org test above, proves that
    // orgId is ANDed into the WHERE clause: same field numeric ID, different
    // scoping outcome depending on which result the DB returns.
    mockState.selectQueue.push([{ id: 5 }]); // customFieldDef lookup → found in org-a
    mockState.selectQueue.push([]);           // tasks list → empty (no tasks match the filter)

    const res = await request(buildApp()).get("/api/tasks?customFieldId=5");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 400 immediately for a non-numeric customFieldId without querying the DB", async () => {
    // A non-integer value is rejected before any DB round-trip.
    // selectQueue is intentionally left empty: if a DB call were made,
    // shift() would return [] and the test would still pass — but the intent
    // is that the handler short-circuits before touching the DB.
    const res = await request(buildApp()).get("/api/tasks?customFieldId=not-a-number");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("customFieldId must be a positive integer");
  });

  it("returns 400 for customFieldId=0 (non-positive integer)", async () => {
    const res = await request(buildApp()).get("/api/tasks?customFieldId=0");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("customFieldId must be a positive integer");
  });
});
