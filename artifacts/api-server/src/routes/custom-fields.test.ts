/**
 * Tests for custom-fields routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /custom-fields              - list active definitions ordered by position
 *  - POST /custom-fields              - body validation, 201, admin-only enforcement
 *  - PATCH /custom-fields/:id         - update name/options, 200, 404, admin-only enforcement
 *  - DELETE /custom-fields/:id        - soft-delete, 204, 404, admin-only enforcement
 *  - POST /custom-fields/reorder      - reorder by ID list, 204, admin-only enforcement
 *  - POST /custom-fields/:id/purge    - cross-org isolation: Org A cannot purge Org B's field
 *  - POST /custom-fields/:id/restore  - cross-org isolation (update WHERE enforces orgId)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  insertCalls: [] as any[],
  updateResult: [] as any[],
  /** When false, the requireOrg mock sets manage_projects = false → requireAdmin blocks */
  isAdmin: true,
  /** orgId injected by the requireOrg mock — override per test to simulate a different caller org */
  orgId: "test-org",
  /** Incremented each time db.delete() is invoked — lets tests assert no deletion occurred */
  deleteCallCount: 0,
}));

/** Hoisted sql stub — must be created before vi.mock factories run. */
const mockSql = vi.hoisted(() =>
  Object.assign(
    (_strings: any, ..._values: any[]) => ({ _isSql: true }),
    {
      join: (_items: any[], _sep?: any) => ({ _isSql: true }),
      raw: (_s: string) => ({ _isSql: true }),
      param: (_v: any) => ({ _isSql: true }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
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

  const dbMock: any = {
    select: () => makeChain(mockState.selectQueue.shift() ?? []),
    execute: () => Promise.resolve([]),
    insert: () => ({
      values: (arg: any) => {
        mockState.insertCalls.push(arg);
        return { returning: () => Promise.resolve(mockState.insertResult) };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.updateResult),
        }),
      }),
    }),
    delete: () => {
      mockState.deleteCallCount += 1;
      return { where: () => Promise.resolve([]) };
    },
    transaction: async (fn: (tx: any) => Promise<any>) => fn(dbMock),
  };

  return {
    db: dbMock,
    customFieldDefinitionsTable: {},
    tasksTable: {},
    taskEventsTable: {},
    workflowStagesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: mockSql,
}));

vi.mock("../lib/log-org-event", () => ({
  logOrgEvent: async () => undefined,
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Missing required permission: ${key}` });
      return;
    }
    next();
  },
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = {
      manage_projects: mockState.isAdmin,
      manage_custom_fields: mockState.isAdmin,
    };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = {
      manage_projects: mockState.isAdmin,
      manage_custom_fields: mockState.isAdmin,
    };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.manage_projects) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
}));

import customFieldsRouter from "./custom-fields.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", customFieldsRouter);
  return app;
}

const MOCK_DEF = {
  id: 1,
  orgId: "test-org",
  name: "Priority Score",
  type: "number",
  options: null,
  position: 0,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_SELECT_DEF = {
  id: 2,
  orgId: "test-org",
  name: "Environment",
  type: "single_select",
  options: ["prod", "staging", "dev"],
  position: 1,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// GET /api/custom-fields
// ---------------------------------------------------------------------------

describe("GET /api/custom-fields", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
  });

  it("returns 200 with an empty array when no definitions exist", async () => {
    mockState.selectQueue.push([]); // no defs in DB

    const res = await request(buildApp()).get("/api/custom-fields");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the list of active definitions", async () => {
    mockState.selectQueue.push([MOCK_DEF, MOCK_SELECT_DEF]);

    const res = await request(buildApp()).get("/api/custom-fields");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 1, name: "Priority Score", type: "number" });
    expect(res.body[1]).toMatchObject({ id: 2, name: "Environment", type: "single_select" });
  });

  it("is accessible by non-admin members (read-only)", async () => {
    mockState.isAdmin = false;
    mockState.selectQueue.push([MOCK_DEF]);

    const res = await request(buildApp()).get("/api/custom-fields");

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/custom-fields — create a field definition (admin only)
// ---------------------------------------------------------------------------

describe("POST /api/custom-fields", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [MOCK_DEF];
    mockState.updateResult = [];
    mockState.isAdmin = true;
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ name: "Priority Score", type: "number" });

    expect(res.status).toBe(403);
  });

  it("returns 400 when the body is missing required fields", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ type: "number" }); // missing name

    expect(res.status).toBe(400);
  });

  it("returns 400 when the type is not one of the allowed values", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ name: "Foo", type: "checkbox" }); // unsupported type

    expect(res.status).toBe(400);
  });

  it("returns 201 with the created definition (number type)", async () => {
    mockState.selectQueue.push([]);  // existing defs for position calculation (empty → position 0)
    mockState.insertResult = [MOCK_DEF];

    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ name: "Priority Score", type: "number" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, name: "Priority Score", type: "number" });
  });

  it("returns 201 with the created definition (single_select with options)", async () => {
    mockState.selectQueue.push([MOCK_DEF]); // one existing def → position = 1
    const selectDef = { ...MOCK_SELECT_DEF, createdAt: MOCK_SELECT_DEF.createdAt, updatedAt: MOCK_SELECT_DEF.updatedAt };
    mockState.insertResult = [selectDef];

    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ name: "Environment", type: "single_select", options: ["prod", "staging"] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Environment", type: "single_select" });
  });

  it("returns 201 for all supported field types", async () => {
    const types = ["text", "date", "multi_select"] as const;

    for (const type of types) {
      mockState.selectQueue.push([]); // fresh for each
      mockState.insertResult = [{ ...MOCK_DEF, type }];

      const body: Record<string, unknown> = { name: `My ${type} field`, type };
      if (type === "multi_select") body.options = ["a", "b"];

      const res = await request(buildApp())
        .post("/api/custom-fields")
        .send(body);

      expect(res.status).toBe(201);
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/custom-fields/:id — update name/options (admin only)
// ---------------------------------------------------------------------------

describe("PATCH /api/custom-fields/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [{ ...MOCK_DEF, name: "Updated Name" }];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ name: "Sneaky Rename" });

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp())
      .patch("/api/custom-fields/abc")
      .send({ name: "X" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the definition is not found or belongs to another org", async () => {
    mockState.updateResult = []; // no row returned → not found

    const res = await request(buildApp())
      .patch("/api/custom-fields/999")
      .send({ name: "Ghost Field" });

    expect(res.status).toBe(404);
  });

  it("returns 200 with the updated definition when renaming", async () => {
    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: "Updated Name" });
  });

  it("returns 409 when attempting to change the field's type", async () => {
    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ type: "text" }); // MOCK_DEF is a "number" field

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/type cannot be changed/i);
  });

  it("returns 409 even when a type change is bundled with an otherwise-valid update", async () => {
    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ name: "Renamed", type: "number" }); // same type value still rejected — type is immutable

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/type cannot be changed/i);
  });

  it("returns 200 when updating options on a select field (no removals)", async () => {
    // currentDef is not found → conflict check skipped; test just verifies main update path
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging", "qa"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging", "qa"] });

    expect(res.status).toBe(200);
    expect(res.body.options).toEqual(["prod", "staging", "qa"]);
  });

  it("renaming a field does not write any task_events rows (pre-existing audit history is preserved as-is)", async () => {
    // A rename-only PATCH sends only { name } — no options update → the option-removal
    // conflict guard is skipped entirely, so db.insert(taskEventsTable) is never called.
    // This guarantees pre-existing events that say "cf:OldName" are never back-patched.
    mockState.insertCalls.length = 0;
    mockState.updateResult = [{ ...MOCK_DEF, name: "Impact" }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ name: "Impact" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Impact");
    // No taskEventsTable inserts — history rows written under "cf:Severity" are untouched
    expect(mockState.insertCalls).toHaveLength(0);
  });

  // ── Cross-org isolation ────────────────────────────────────────────────────

  it("returns 404 when an admin from org-a tries to rename a field belonging to org-b", async () => {
    // Caller is authenticated as org-a. The UPDATE WHERE clause enforces AND orgId = 'org-a',
    // so field id=55 (which belongs to org-b) matches no rows → updateResult stays empty.
    mockState.orgId = "org-a";
    mockState.updateResult = []; // no matching row — cross-org update is a no-op

    const res = await request(buildApp())
      .patch("/api/custom-fields/55")
      .send({ name: "Stolen Name" });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/custom-fields/:id — option removal conflict guard
// ---------------------------------------------------------------------------

describe("PATCH /api/custom-fields/:id — option removal conflict guard", () => {
  // field id=2 is referenced by the route param "/api/custom-fields/2"
  const SINGLE_SELECT_DEF = { type: "single_select", options: ["prod", "staging", "dev"], name: "Environment" };
  const MULTI_SELECT_DEF  = { type: "multi_select",  options: ["A", "B", "C"], name: "Tags" };

  // Three tasks that have the stale "dev" value stored under field id=2
  const AFFECTED_SINGLE_TASKS = [
    { id: 10, customFields: { "2": "dev" } },
    { id: 11, customFields: { "2": "dev" } },
    { id: 12, customFields: { "2": "dev" } },
  ];

  // Five tasks that have stale multi-select values under field id=2
  const AFFECTED_MULTI_TASKS = [
    { id: 20, customFields: { "2": ["A", "B"] } },
    { id: 21, customFields: { "2": ["B", "C"] } },
    { id: 22, customFields: { "2": ["A", "C"] } },
    { id: 23, customFields: { "2": ["B"] } },
    { id: 24, customFields: { "2": ["A", "B", "C"] } },
  ];

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
  });

  it("returns 409 with affectedTaskCount when a removed single_select option is in use", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]);      // currentDef lookup
    mockState.selectQueue.push(AFFECTED_SINGLE_TASKS);    // affected tasks (length=3)

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] }); // removing "dev"

    expect(res.status).toBe(409);
    expect(res.body.affectedTaskCount).toBe(3);
    expect(typeof res.body.error).toBe("string");
  });

  it("returns 409 with affectedTaskCount when a removed multi_select option is in use", async () => {
    mockState.selectQueue.push([MULTI_SELECT_DEF]);    // currentDef lookup
    mockState.selectQueue.push(AFFECTED_MULTI_TASKS);  // affected tasks (length=5)

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["A"] }); // removing "B" and "C"

    expect(res.status).toBe(409);
    expect(res.body.affectedTaskCount).toBe(5);
  });

  it("returns 200 and clears stale values when force=true", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]);   // currentDef lookup
    mockState.selectQueue.push(AFFECTED_SINGLE_TASKS); // affected tasks
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"], force: true });

    expect(res.status).toBe(200);
    expect(res.body.options).toEqual(["prod", "staging"]);
  });

  it("returns 200 when removed options are not stored in any task", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([]);                    // no affected tasks
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] }); // removing "dev" but no tasks use it

    expect(res.status).toBe(200);
  });

  it("skips conflict check and returns 200 when no options are removed (only additions)", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef lookup — no count query follows
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging", "dev", "qa"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging", "dev", "qa"] }); // adding "qa", nothing removed

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/custom-fields/:id — audit events for force option cleanup
// ---------------------------------------------------------------------------

describe("PATCH /api/custom-fields/:id — audit events for force cleanup", () => {
  const SINGLE_SELECT_DEF = { type: "single_select", options: ["prod", "staging", "dev"], name: "Environment" };
  const MULTI_SELECT_DEF  = { type: "multi_select",  options: ["A", "B", "C"], name: "Tags" };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging"] }];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
  });

  it("inserts one audit event per affected task when a single_select option is force-removed", async () => {
    const affectedTasks = [
      { id: 10, customFields: { "2": "dev" } },
      { id: 11, customFields: { "2": "dev" } },
    ];
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef
    mockState.selectQueue.push(affectedTasks);         // affected tasks

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"], force: true });

    // One insert batch for the task_events rows
    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      taskId: 10,
      orgId: "test-org",
      field: "cf:Environment",
      oldValue: "dev",
      newValue: null,
    });
    expect(events[1]).toMatchObject({
      taskId: 11,
      orgId: "test-org",
      field: "cf:Environment",
      oldValue: "dev",
      newValue: null,
    });
  });

  it("records the actor id and name on the audit events", async () => {
    const affectedTasks = [{ id: 10, customFields: { "2": "dev" } }];
    mockState.selectQueue.push([SINGLE_SELECT_DEF]);
    mockState.selectQueue.push(affectedTasks);

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"], force: true });

    expect(mockState.insertCalls).toHaveLength(1);
    // requireOrg mock sets req.user = { id: "user-1", email: "user@example.com" }
    expect(mockState.insertCalls[0][0]).toMatchObject({
      actorId: "user-1",
      actorName: "user@example.com",
    });
  });

  it("inserts one audit event per affected task when a multi_select option is force-removed", async () => {
    const affectedTasks = [
      { id: 20, customFields: { "2": ["A", "B"] } }, // B is removed, A stays
      { id: 21, customFields: { "2": ["B", "C"] } }, // both B and C removed → empty
    ];
    mockState.selectQueue.push([MULTI_SELECT_DEF]);
    mockState.selectQueue.push(affectedTasks);

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["A"], force: true }); // removing B and C

    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(2);
    // Task 20: A stays, B removed → newValue is the filtered array
    expect(events[0]).toMatchObject({
      taskId: 20,
      field: "cf:Tags",
      oldValue: JSON.stringify(["A", "B"]),
      newValue: JSON.stringify(["A"]),
    });
    // Task 21: both B and C removed → nothing left → newValue=null
    expect(events[1]).toMatchObject({
      taskId: 21,
      field: "cf:Tags",
      oldValue: JSON.stringify(["B", "C"]),
      newValue: null,
    });
  });

  it("inserts no audit events when no tasks are affected by the option removal", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef
    mockState.selectQueue.push([]);                    // no affected tasks

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"], force: true });

    expect(mockState.insertCalls).toHaveLength(0);
  });

  it("inserts no audit events when force is not supplied (request rejected with 409)", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]);
    mockState.selectQueue.push([{ id: 10, customFields: { "2": "dev" } }]);

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] }); // no force

    // 409 is returned before any event insertion
    expect(mockState.insertCalls).toHaveLength(0);
  });

  it("uses the pre-rename field name in audit events when name and options are updated together", async () => {
    // When a PATCH sends both { name: "Env", options: [...], force: true }, the audit
    // events are written BEFORE the definition update is applied, so currentDef.name
    // ("Environment") is used — not the incoming new name ("Env").
    // This means the audit trail reads "cf:Environment cleared" regardless of any
    // subsequent rename, matching what older events already record.
    const affectedTasks = [{ id: 10, customFields: { "2": "dev" } }];
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef — name is still "Environment"
    mockState.selectQueue.push(affectedTasks);
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, name: "Env", options: ["prod", "staging"] }];

    await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ name: "Env", options: ["prod", "staging"], force: true });

    expect(mockState.insertCalls).toHaveLength(1);
    // Audit label reflects the name at the time of the event, not the new name "Env"
    expect(mockState.insertCalls[0][0]).toMatchObject({
      field: "cf:Environment",
      oldValue: "dev",
      newValue: null,
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/custom-fields/:id — soft-delete (admin only)
// ---------------------------------------------------------------------------

describe("DELETE /api/custom-fields/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_DEF]; // soft-delete returns the updated row
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp()).delete("/api/custom-fields/1");

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).delete("/api/custom-fields/abc");

    expect(res.status).toBe(400);
  });

  it("returns 404 when the definition is not found or already deleted", async () => {
    mockState.updateResult = []; // no row returned → already deleted or unknown

    const res = await request(buildApp()).delete("/api/custom-fields/999");

    expect(res.status).toBe(404);
  });

  it("returns 204 on a successful soft-delete", async () => {
    const res = await request(buildApp()).delete("/api/custom-fields/1");

    expect(res.status).toBe(204);
  });

  // ── Cross-org isolation ────────────────────────────────────────────────────

  it("returns 404 when an admin from org-a tries to soft-delete a field belonging to org-b", async () => {
    // Caller is authenticated as org-a. The UPDATE WHERE clause enforces AND orgId = 'org-a',
    // so field id=55 (which belongs to org-b) matches no rows → updateResult stays empty.
    mockState.orgId = "org-a";
    mockState.updateResult = []; // no matching row — cross-org soft-delete is a no-op

    const res = await request(buildApp()).delete("/api/custom-fields/55");

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/custom-fields/:id/restore — un-soft-delete a field (admin only)
// ---------------------------------------------------------------------------

describe("POST /api/custom-fields/:id/restore", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
    mockState.deleteCallCount = 0;
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp()).post("/api/custom-fields/1/restore");

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).post("/api/custom-fields/abc/restore");

    expect(res.status).toBe(400);
  });

  it("returns 404 when the field is already active (not soft-deleted)", async () => {
    mockState.updateResult = []; // no row returned — field active or missing

    const res = await request(buildApp()).post("/api/custom-fields/1/restore");

    expect(res.status).toBe(404);
  });

  it("returns 200 with the restored field definition", async () => {
    const restored = { ...MOCK_DEF, deletedAt: null };
    mockState.updateResult = [restored];

    const res = await request(buildApp()).post("/api/custom-fields/1/restore");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: "Priority Score", deletedAt: null });
  });

  // ── Cross-org isolation ────────────────────────────────────────────────────

  it("returns 404 when an admin from org-a tries to restore a soft-deleted field belonging to org-b", async () => {
    // Caller authenticated as org-a; the UPDATE WHERE clause includes AND orgId = 'org-a',
    // so field id=55 (which belongs to org-b) matches no rows → updateResult stays empty.
    mockState.orgId = "org-a";
    mockState.updateResult = []; // no matching row — cross-org update is a no-op

    const res = await request(buildApp()).post("/api/custom-fields/55/restore");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/different org/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/custom-fields/:id/purge — hard-delete + data wipe (admin only)
// ---------------------------------------------------------------------------

describe("POST /api/custom-fields/:id/purge", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
    mockState.deleteCallCount = 0;
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp()).post("/api/custom-fields/1/purge");

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).post("/api/custom-fields/abc/purge");

    expect(res.status).toBe(400);
  });

  it("returns 404 when the field does not exist in the org", async () => {
    // transaction → first select returns [] (field not found)
    mockState.selectQueue.push([]); // existing field lookup → not found

    const res = await request(buildApp()).post("/api/custom-fields/999/purge");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 with affectedTaskCount=0 when no tasks carry a value", async () => {
    mockState.selectQueue.push([{ id: 1, name: "Priority Score" }]); // field exists
    mockState.selectQueue.push([]);                                    // no affected tasks

    const res = await request(buildApp()).post("/api/custom-fields/1/purge");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deletedFieldId: 1, affectedTaskCount: 0 });
  });

  it("returns 200 with the correct affectedTaskCount when tasks are wiped", async () => {
    const affectedTasks = Array.from({ length: 7 }, (_, i) => ({
      id: 100 + i,
      customFields: { "1": "some-value" },
    }));
    mockState.selectQueue.push([{ id: 1, name: "Priority Score" }]); // field exists
    mockState.selectQueue.push(affectedTasks);                         // 7 affected tasks

    const res = await request(buildApp()).post("/api/custom-fields/1/purge");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deletedFieldId: 1, affectedTaskCount: 7 });
  });

  // ── Cross-org isolation ────────────────────────────────────────────────────

  it("returns 404 when an admin from org-a tries to purge a field belonging to org-b", async () => {
    // The caller is authenticated as org-a
    mockState.orgId = "org-a";
    // The DB returns no row because the WHERE clause includes AND orgId = 'org-a',
    // but field id=42 belongs to org-b — so the lookup comes back empty.
    mockState.selectQueue.push([]); // field lookup → not found for this org

    const res = await request(buildApp()).post("/api/custom-fields/42/purge");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("does not call db.delete when the field belongs to a different org", async () => {
    // Caller is org-a; field 42 belongs to org-b → lookup returns empty
    mockState.orgId = "org-a";
    mockState.selectQueue.push([]); // cross-org lookup yields no match

    await request(buildApp()).post("/api/custom-fields/42/purge");

    // delete must never be reached — no data from any org should be erased
    expect(mockState.deleteCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/custom-fields/:id/purge — audit trail
// ---------------------------------------------------------------------------

describe("POST /api/custom-fields/:id/purge — audit trail", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
    mockState.deleteCallCount = 0;
  });

  it("inserts one audit event per affected task with field=cf:<name>, oldValue, and newValue=null (single value)", async () => {
    // Field id=5, name="Environment"; two tasks store a single-select string value
    const affectedTasks = [
      { id: 10, customFields: { "5": "prod" } },
      { id: 11, customFields: { "5": "staging" } },
    ];
    mockState.selectQueue.push([{ id: 5, name: "Environment" }]); // field definition
    mockState.selectQueue.push(affectedTasks);                      // tasks carrying values

    const res = await request(buildApp()).post("/api/custom-fields/5/purge");

    expect(res.status).toBe(200);
    // One insert batch for task_events
    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      taskId: 10,
      orgId: "test-org",
      field: "cf:Environment",
      oldValue: JSON.stringify("prod"),
      newValue: null,
    });
    expect(events[1]).toMatchObject({
      taskId: 11,
      orgId: "test-org",
      field: "cf:Environment",
      oldValue: JSON.stringify("staging"),
      newValue: null,
    });
  });

  it("inserts one audit event per affected task for array (multi_select) values", async () => {
    // Field id=3, name="Tags"; tasks store multi-select arrays
    const affectedTasks = [
      { id: 20, customFields: { "3": ["A", "B"] } },
      { id: 21, customFields: { "3": ["B", "C"] } },
    ];
    mockState.selectQueue.push([{ id: 3, name: "Tags" }]); // field definition
    mockState.selectQueue.push(affectedTasks);               // tasks carrying values

    const res = await request(buildApp()).post("/api/custom-fields/3/purge");

    expect(res.status).toBe(200);
    expect(mockState.insertCalls).toHaveLength(1);
    const events: any[] = mockState.insertCalls[0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      taskId: 20,
      field: "cf:Tags",
      oldValue: JSON.stringify(["A", "B"]),
      newValue: null,
    });
    expect(events[1]).toMatchObject({
      taskId: 21,
      field: "cf:Tags",
      oldValue: JSON.stringify(["B", "C"]),
      newValue: null,
    });
  });

  it("records the acting admin's id and name on every audit event", async () => {
    const affectedTasks = [{ id: 30, customFields: { "5": "prod" } }];
    mockState.selectQueue.push([{ id: 5, name: "Environment" }]);
    mockState.selectQueue.push(affectedTasks);

    await request(buildApp()).post("/api/custom-fields/5/purge");

    // requireOrg mock sets req.user = { id: "user-1", email: "user@example.com" }
    expect(mockState.insertCalls).toHaveLength(1);
    expect(mockState.insertCalls[0][0]).toMatchObject({
      actorId: "user-1",
      actorName: "user@example.com",
    });
  });

  it("inserts no audit events when no tasks carry a value for the purged field", async () => {
    mockState.selectQueue.push([{ id: 5, name: "Environment" }]); // field exists
    mockState.selectQueue.push([]);                                  // no affected tasks

    const res = await request(buildApp()).post("/api/custom-fields/5/purge");

    expect(res.status).toBe(200);
    expect(mockState.insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/custom-fields/reorder — reorder by ID list (admin only)
// ---------------------------------------------------------------------------

describe("POST /api/custom-fields/reorder", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
    mockState.orgId = "test-org";
    mockState.deleteCallCount = 0;
  });

  it("returns 403 when a non-admin member calls the endpoint", async () => {
    mockState.isAdmin = false;

    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [2, 1] });

    expect(res.status).toBe(403);
  });

  it("returns 400 when the body is missing ids", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when ids contains a non-integer", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [1, "two", 3] });

    expect(res.status).toBe(400);
  });

  it("returns 204 on a successful reorder", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [2, 1, 3] });

    expect(res.status).toBe(204);
  });

  it("returns 204 for a single-element reorder (no-op)", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [1] });

    expect(res.status).toBe(204);
  });

  // ── Cross-org isolation ────────────────────────────────────────────────────

  it("returns 204 and silently ignores IDs belonging to a different org", async () => {
    // Caller is org-a. The supplied IDs (200, 201) belong to org-b.
    // The UPDATE WHERE clause includes AND orgId = 'org-a', so each update
    // matches 0 rows — the positions of org-b's fields are never touched.
    // The endpoint returns 204 because a no-op reorder is not an error.
    mockState.orgId = "org-a";

    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [200, 201] });

    expect(res.status).toBe(204);
    // No delete should have been triggered either
    expect(mockState.deleteCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Role-field body injection — sending `role: "admin"` in the body must have
// no effect on authorization.  The authorization decision is made entirely
// from req.orgPermissions (set server-side by requireOrgMiddleware from the
// DB membership row), never from any client-supplied field.
// ---------------------------------------------------------------------------

describe("Body 'role' field injection — role: admin in request body never elevates privileges", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    // Caller is a plain member for every test in this block.
    mockState.isAdmin = false;
  });

  it("POST /custom-fields — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields")
      .send({ name: "Sneaky Field", type: "number", role: "admin" });

    expect(res.status).toBe(403);
  });

  it("PATCH /custom-fields/:id — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .patch("/api/custom-fields/1")
      .send({ name: "Sneaky Rename", role: "admin" });

    expect(res.status).toBe(403);
  });

  it("DELETE /custom-fields/:id — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .delete("/api/custom-fields/1")
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });

  it("POST /custom-fields/reorder — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/reorder")
      .send({ ids: [1, 2], role: "admin" });

    expect(res.status).toBe(403);
  });

  it("POST /custom-fields/:id/purge — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/1/purge")
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });

  it("POST /custom-fields/:id/restore — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/custom-fields/1/restore")
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// PATCH /api/custom-fields/:id — org isolation for option-removal conflict
// check (#224)
//
// The conflict check queries tasks WHERE customFields->>fieldId IS NOT NULL
// AND orgId = :orgId.  When the orgId clause is present, tasks from org-b
// that happen to store the same option string cannot trigger a 409 for org-a.
// ===========================================================================

describe("PATCH /api/custom-fields/:id — org isolation on option-removal conflict check (#224)", () => {
  // Reuse the module-level MOCK_SELECT_DEF fixture which matches the full DB
  // row shape (id, orgId, name, type, options, position, deletedAt, createdAt,
  // updatedAt) that the update returning() mock returns.
  // The isolation behavior we're testing: the conflict-check WHERE clause
  // scopes tasks to req.orgId, so org-b tasks never appear in the check result.

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
  });

  it("returns 200 when no org-a tasks use the removed option (even if org-b tasks do)", async () => {
    // The mock simulates: org-a's conflict query returns [] because the WHERE
    // clause scopes to org-a only.  Org-b tasks with "dev" are never returned.
    // MOCK_SELECT_DEF (module-scope) has the full field shape including position/timestamps
    mockState.selectQueue.push([MOCK_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([]);                 // conflict check → 0 org-a rows
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] }); // removing "dev"

    expect(res.status).toBe(200);
    expect(res.body.options).toEqual(["prod", "staging"]);
  });

  it("returns 409 when org-a tasks ARE using the removed option", async () => {
    const ORG_A_TASKS = [{ id: 10, customFields: { "2": "dev" } }];

    mockState.selectQueue.push([MOCK_SELECT_DEF]);
    mockState.selectQueue.push(ORG_A_TASKS); // org-a has one affected task

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] });

    expect(res.status).toBe(409);
    expect(res.body.affectedTaskCount).toBe(1);
  });
});

// ===========================================================================
// POST /api/custom-fields/:id/purge — audit trail for already-soft-deleted field
// (#236)
//
// If an admin soft-deletes a field and then purges it, the purge audit events
// must still carry the field name (not null).  The route reads the field name
// BEFORE deleting the DB row so the audit events remain meaningful.
// ===========================================================================

describe("POST /api/custom-fields/:id/purge — audit trail for soft-deleted field (#236)", () => {
  const SOFT_DELETED_DEF = {
    id: 3,
    orgId: "test-org",
    name: "Severity",
    type: "single_select",
    options: ["P1", "P2", "P3"],
    deletedAt: new Date(Date.now() - 60_000), // already soft-deleted
  };

  const AFFECTED_TASKS = [
    { id: 101, customFields: { "3": "P1" } },
    { id: 102, customFields: { "3": "P2" } },
  ];

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.isAdmin = true;
  });

  it("writes audit events with the field name even when the field is already soft-deleted", async () => {
    // The purge route reads the field first, then finds affected tasks, then audits.
    // Even if deletedAt is set, the route must still be able to read the field name.
    mockState.selectQueue.push([SOFT_DELETED_DEF]);  // field lookup (includeing soft-deleted)
    mockState.selectQueue.push(AFFECTED_TASKS);       // affected tasks

    // insertCalls will capture the audit event inserts
    const res = await request(buildApp()).post("/api/custom-fields/3/purge");

    expect(res.status).toBe(200);
    expect(res.body.affectedTaskCount).toBe(2);

    // Verify audit events were written with the correct field name
    const auditEvents = mockState.insertCalls.filter(
      (c: any) => Array.isArray(c) && c.some((e: any) => e.field?.startsWith("cf:")),
    );
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);

    const firstEvent = auditEvents[0][0];
    expect(firstEvent.field).toContain("Severity"); // field name must not be null
    expect(firstEvent.newValue).toBeNull();
  });
});
