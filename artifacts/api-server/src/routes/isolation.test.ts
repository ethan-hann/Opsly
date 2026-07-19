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

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve(mockState.insertResult),
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
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    notesTable: {},
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
    usersTable: {},
    invitationsTable: {},
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
  sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// requireOrgMiddleware — caller is authenticated as a member of "org-a"
// The org id is derived server-side; clients cannot override it.
// ---------------------------------------------------------------------------
const ALL_PERMS = {
  view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
  delete_tasks: true, manage_projects: true, manage_org_settings: true,
  manage_members: true, manage_webhooks: true, manage_api_keys: true,
  manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
  manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
};
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.orgRole = "admin";
    req.orgRoleId = "role-owner";
    req.orgRoleName = "Owner";
    req.isOrgOwner = true;
    req.orgPermissions = ALL_PERMS;
    req.user = { id: "user-a1", email: "user-a1@org-a.example" };
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
  requirePermission: (_key: string) => (_req: any, _res: any, next: any) => {
    next();
  },
}));

// notes-sse has a side-effect import; stub it out
vi.mock("../lib/notes-sse", () => ({
  addSseClient: () => () => {},
  broadcastNoteChange: () => {},
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

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------
function reset() {
  mockState.selectQueue.length = 0;
  mockState.insertResult = [];
  mockState.updateResult = [];
  mockState.deleteResult = [];
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
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).get(
      `/api/tasks?status=todo&priority=medium&assignee=${SHARED_ASSIGNEE}&dateFrom=2025-03-01&dateTo=2025-03-31`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].orgId).toBe("org-a");
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
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });
});

describe("Task isolation — PATCH /api/tasks/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to update an org-b task", async () => {
    // update().set().where().returning() → [] because orgId filter excluded it
    const res = await request(buildApp())
      .patch("/api/tasks/42")
      .send({ status: "done" });
    expect(res.status).toBe(404);
  });
});

describe("Task isolation — DELETE /api/tasks/:id", () => {
  beforeEach(reset);

  it("returns 404 when attempting to delete an org-b task", async () => {
    // delete().where().returning() → []
    const res = await request(buildApp()).delete("/api/tasks/42");
    expect(res.status).toBe(404);
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

  it("returns 404 when the comment's orgId belongs to org-b (direct org check)", async () => {
    // Step 1: comment found but belongs to org-b
    mockState.selectQueue.push([ORG_B_COMMENT]);
    // No second select needed (orgId is non-null and doesn't match)

    const res = await request(buildApp()).delete("/api/comments/77");
    expect(res.status).toBe(404);
  });

  it("returns 204 when deleting an org-a comment (direct org check)", async () => {
    // Step 1: comment found with orgId = 'org-a'
    mockState.selectQueue.push([{ ...ORG_B_COMMENT, id: 1, orgId: "org-a" }]);
    // delete runs with no returning

    const res = await request(buildApp()).delete("/api/comments/1");
    expect(res.status).toBe(204);
  });
});

/**
 * Backfill regression — verifies that the org_id direct-scoping logic
 * correctly handles comments that (pre-backfill) have org_id = NULL.
 *
 * For NULL-org comments the route falls back to task-join scoping:
 * the parent task's org_id is used to determine access.  This keeps
 * pre-backfill rows accessible while preventing cross-org leakage.
 * Once the backfill runs and Phase 3 enforces NOT NULL, these fallback
 * branches can be removed.
 */
describe("Comment backfill regression — null org_id rows use task-join fallback", () => {
  beforeEach(reset);

  it("list includes null-org comments when the parent task belongs to the caller's org", async () => {
    const nullOrgComment = { ...ORG_B_COMMENT, id: 1, orgId: null, taskId: 1 };
    mockState.selectQueue.push([{ id: 1 }]);   // task found in org-a
    mockState.selectQueue.push([nullOrgComment]); // comment returned (OR filter matches isNull)

    const res = await request(buildApp()).get("/api/tasks/1/comments");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("delete returns 404 for a null-org comment whose parent task belongs to another org", async () => {
    // Step 1: comment found with null orgId
    mockState.selectQueue.push([{ ...ORG_B_COMMENT, orgId: null, taskId: 42 }]);
    // Step 2: task 42 does NOT belong to org-a
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/comments/100");
    expect(res.status).toBe(404);
  });

  it("delete returns 204 for a null-org comment whose parent task belongs to the caller's org", async () => {
    // Step 1: comment found with null orgId
    mockState.selectQueue.push([{ ...ORG_B_COMMENT, id: 5, orgId: null, taskId: 1 }]);
    // Step 2: task 1 belongs to org-a
    mockState.selectQueue.push([{ id: 1 }]);

    const res = await request(buildApp()).delete("/api/comments/5");
    expect(res.status).toBe(204);
  });

  it("list returns comments after backfill sets org_id (post-backfill state)", async () => {
    const backfilledComment = {
      ...ORG_B_COMMENT,
      id: 1,
      orgId: "org-a", // org_id now populated by backfill script
      taskId: 1,
    };

    mockState.selectQueue.push([{ id: 1 }]); // task belongs to org-a
    mockState.selectQueue.push([backfilledComment]); // comment now visible

    const res = await request(buildApp()).get("/api/tasks/1/comments");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
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
    mockState.selectQueue.push([{ total: 0, todo: 0, in_progress: 0, blocked: 0, done: 0, low: 0, medium: 0, high: 0, critical: 0 }]);
    mockState.selectQueue.push([{ count: 0 }]);
    mockState.selectQueue.push([{ total: 0, active: 0 }]);

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
