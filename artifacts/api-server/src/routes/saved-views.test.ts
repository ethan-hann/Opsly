/**
 * Tests confirming saved views round-trip the four new filter fields:
 * watching, slaBreached, overdue, and stageType.
 *
 * Covered:
 *  - POST /views stores all four fields exactly as sent
 *  - GET  /views returns all four fields intact when they are present
 *  - POST /views without the four fields leaves them absent (not false/null)
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
          };
        },
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    },
    savedViewsTable: {},
    tasksTable: {},
    projectsTable: {},
    orgMembersTable: {},
    usersTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  ne: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  inArray: () => ({}),
  sql: () => ({}),
  getTableColumns: (t: any) => t,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/api-zod — passthrough schemas
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
    ListViewsResponse: p,
    CreateViewBody: p,
    CreateViewResponse: p,
    UpdateViewParams: p,
    UpdateViewBody: p,
    UpdateViewResponse: p,
    DeleteViewParams: p,
  };
});

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    req.orgPermissions = { manage_saved_views: true };
    next();
  },
}));

import savedViewsRouter from "./saved-views.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(savedViewsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeViewRow(filters: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 1,
    orgId: "test-org",
    createdBy: "user-owner",
    name: "Test View",
    filters,
    isOrgWide: false,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("saved-views round-trip — four new filter fields", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
  });

  describe("POST /views", () => {
    it("persists watching, slaBreached, overdue, and stageType to the database", async () => {
      mockState.insertResult = [
        makeViewRow({
          watching: true,
          slaBreached: true,
          overdue: true,
          stageType: "open",
        }),
      ];

      const res = await request(app)
        .post("/views")
        .send({
          name: "New Filters View",
          filters: {
            watching: true,
            slaBreached: true,
            overdue: true,
            stageType: "open",
          },
        });

      expect(res.status).toBe(201);
      expect(mockState.insertCalls).toHaveLength(1);

      const stored = mockState.insertCalls[0];
      expect(stored.filters.watching).toBe(true);
      expect(stored.filters.slaBreached).toBe(true);
      expect(stored.filters.overdue).toBe(true);
      expect(stored.filters.stageType).toBe("open");
    });

    it("returns the four fields in the 201 response body", async () => {
      const filters = {
        watching: true,
        slaBreached: true,
        overdue: true,
        stageType: "open",
      };
      mockState.insertResult = [makeViewRow(filters)];

      const res = await request(app)
        .post("/views")
        .send({ name: "New Filters View", filters });

      expect(res.status).toBe(201);
      expect(res.body.filters.watching).toBe(true);
      expect(res.body.filters.slaBreached).toBe(true);
      expect(res.body.filters.overdue).toBe(true);
      expect(res.body.filters.stageType).toBe("open");
    });

    it("does NOT store the four fields when they are absent from the request", async () => {
      mockState.insertResult = [makeViewRow({ status: "open" })];

      const res = await request(app)
        .post("/views")
        .send({ name: "Basic View", filters: { status: "open" } });

      expect(res.status).toBe(201);
      const stored = mockState.insertCalls[0];
      expect(stored.filters.watching).toBeUndefined();
      expect(stored.filters.slaBreached).toBeUndefined();
      expect(stored.filters.overdue).toBeUndefined();
      expect(stored.filters.stageType).toBeUndefined();
    });
  });

  describe("GET /views", () => {
    it("returns all four new filter fields intact when they are stored", async () => {
      mockState.selectQueue.push([
        makeViewRow({
          watching: true,
          slaBreached: true,
          overdue: true,
          stageType: "open",
        }),
      ]);

      const res = await request(app).get("/views");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const view = res.body[0];
      expect(view.filters.watching).toBe(true);
      expect(view.filters.slaBreached).toBe(true);
      expect(view.filters.overdue).toBe(true);
      expect(view.filters.stageType).toBe("open");
    });

    it("returns views without the four fields when they were not stored", async () => {
      mockState.selectQueue.push([makeViewRow({ status: "open" })]);

      const res = await request(app).get("/views");

      expect(res.status).toBe(200);
      const view = res.body[0];
      expect(view.filters.watching).toBeUndefined();
      expect(view.filters.slaBreached).toBeUndefined();
      expect(view.filters.overdue).toBeUndefined();
      expect(view.filters.stageType).toBeUndefined();
    });
  });

  describe("full round-trip", () => {
    it("what is POSTed in filters is returned verbatim by GET", async () => {
      const filters = {
        watching: true,
        slaBreached: true,
        overdue: true,
        stageType: "closed",
        status: "urgent",
      };

      // Step 1: POST stores the view
      mockState.insertResult = [makeViewRow(filters)];
      const postRes = await request(app)
        .post("/views")
        .send({ name: "Round-trip View", filters });

      expect(postRes.status).toBe(201);
      const storedFilters = mockState.insertCalls[0].filters;

      // Step 2: GET returns the same data (simulate DB returning what was stored)
      mockState.selectQueue.push([makeViewRow(storedFilters)]);
      const getRes = await request(app).get("/views");

      expect(getRes.status).toBe(200);
      const returned = getRes.body[0].filters;
      expect(returned.watching).toBe(storedFilters.watching);
      expect(returned.slaBreached).toBe(storedFilters.slaBreached);
      expect(returned.overdue).toBe(storedFilters.overdue);
      expect(returned.stageType).toBe(storedFilters.stageType);
    });
  });
});
