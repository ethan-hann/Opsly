/**
 * Tests for custom-fields routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /custom-fields          - list active definitions ordered by position
 *  - POST /custom-fields          - body validation, 201, admin-only enforcement
 *  - PATCH /custom-fields/:id     - update name/options, 200, 404, admin-only enforcement
 *  - DELETE /custom-fields/:id    - soft-delete, 204, 404, admin-only enforcement
 *  - POST /custom-fields/reorder  - reorder by ID list, 204, admin-only enforcement
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
  updateResult: [] as any[],
  /** When false, the requireOrg mock sets manage_org_settings = false → requireAdmin blocks */
  isAdmin: true,
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
      execute: () => Promise.resolve([]),
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
    },
    customFieldDefinitionsTable: {},
    tasksTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  asc: () => ({}),
  sql: mockSql,
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = {
      manage_org_settings: mockState.isAdmin,
    };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.manage_org_settings) {
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

  it("returns 200 when updating options on a select field (no removals)", async () => {
    // currentDef is not found → conflict check skipped; test just verifies main update path
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging", "qa"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging", "qa"] });

    expect(res.status).toBe(200);
    expect(res.body.options).toEqual(["prod", "staging", "qa"]);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/custom-fields/:id — option removal conflict guard
// ---------------------------------------------------------------------------

describe("PATCH /api/custom-fields/:id — option removal conflict guard", () => {
  const SINGLE_SELECT_DEF = { type: "single_select", options: ["prod", "staging", "dev"] };
  const MULTI_SELECT_DEF  = { type: "multi_select",  options: ["A", "B", "C"] };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.isAdmin = true;
  });

  it("returns 409 with affectedTaskCount when a removed single_select option is in use", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([{ count: 3 }]);       // affected-task count

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"] }); // removing "dev"

    expect(res.status).toBe(409);
    expect(res.body.affectedTaskCount).toBe(3);
    expect(typeof res.body.error).toBe("string");
  });

  it("returns 409 with affectedTaskCount when a removed multi_select option is in use", async () => {
    mockState.selectQueue.push([MULTI_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([{ count: 5 }]);      // affected-task count

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["A"] }); // removing "B" and "C"

    expect(res.status).toBe(409);
    expect(res.body.affectedTaskCount).toBe(5);
  });

  it("returns 200 and clears stale values when force=true", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([{ count: 3 }]);       // affected-task count
    mockState.updateResult = [{ ...MOCK_SELECT_DEF, options: ["prod", "staging"] }];

    const res = await request(buildApp())
      .patch("/api/custom-fields/2")
      .send({ options: ["prod", "staging"], force: true });

    expect(res.status).toBe(200);
    expect(res.body.options).toEqual(["prod", "staging"]);
  });

  it("returns 200 when removed options are not stored in any task", async () => {
    mockState.selectQueue.push([SINGLE_SELECT_DEF]); // currentDef lookup
    mockState.selectQueue.push([{ count: 0 }]);       // zero affected tasks
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
// DELETE /api/custom-fields/:id — soft-delete (admin only)
// ---------------------------------------------------------------------------

describe("DELETE /api/custom-fields/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_DEF]; // soft-delete returns the updated row
    mockState.isAdmin = true;
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
});
