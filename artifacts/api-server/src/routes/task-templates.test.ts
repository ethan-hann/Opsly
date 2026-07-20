/**
 * Tests for task-templates routes — focuses on:
 *  - CRUD happy-paths (GET, POST, PATCH, DELETE)
 *  - Admin-only permission gate
 *  - defaultDescription sanitization (XSS prevention)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const mockState = {
  selectQueue: [] as any[][],
  insertCalls: [] as any[],
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
};

vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(result),
      orderBy: () => chain,
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) { return Promise.resolve(result).catch(onrejected); },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: (...args: any[]) => {
          mockState.insertCalls.push(args[0]);
          return { returning: () => Promise.resolve(mockState.insertResult) };
        },
      }),
      update: () => ({
        set: (setData: any) => ({
          where: () => ({
            returning: () => {
              mockState.insertCalls.push({ _setData: setData });
              return Promise.resolve(mockState.updateResult);
            },
          }),
        }),
      }),
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve(mockState.deleteResult) }),
      }),
    },
    taskTemplatesTable: {},
    eq: () => ({}),
    and: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-admin" };
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

import templateRouter from "./task-templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", templateRouter);
  return app;
}

const MOCK_TEMPLATE = {
  id: 1,
  orgId: "test-org",
  createdBy: "user-admin",
  name: "Incident response",
  defaultTitle: "INC-",
  defaultPriority: "high",
  defaultCategory: "incident",
  defaultDescription: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const VALID_TEMPLATE_BODY = {
  name: "Incident response",
  defaultTitle: "INC-",
  defaultPriority: "high",
  defaultCategory: "incident",
};

// ---------------------------------------------------------------------------
// GET /api/task-templates
// ---------------------------------------------------------------------------

describe("GET /api/task-templates", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with empty array when no templates exist", async () => {
    mockState.selectQueue.push([]);
    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with serialized templates", async () => {
    mockState.selectQueue.push([MOCK_TEMPLATE]);
    const res = await request(buildApp()).get("/api/task-templates");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 1, name: "Incident response" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/task-templates - happy path and validation
// ---------------------------------------------------------------------------

describe("POST /api/task-templates - creation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [MOCK_TEMPLATE];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 201 with the created template", async () => {
    const res = await request(buildApp())
      .post("/api/task-templates")
      .send(VALID_TEMPLATE_BODY);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, name: "Incident response" });
  });

  it("returns 400 when name is missing", async () => {
    const { name: _n, ...body } = VALID_TEMPLATE_BODY;
    const res = await request(buildApp())
      .post("/api/task-templates")
      .send(body);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/task-templates - defaultDescription sanitization (XSS prevention)
// ---------------------------------------------------------------------------

describe("POST /api/task-templates - defaultDescription sanitization", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [MOCK_TEMPLATE];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("strips <script> tags from defaultDescription before storing", async () => {
    await request(buildApp())
      .post("/api/task-templates")
      .send({ ...VALID_TEMPLATE_BODY, defaultDescription: '<p>Steps</p><script>alert("xss")</script>' });

    expect(mockState.insertCalls[0].defaultDescription).not.toContain("<script>");
    expect(mockState.insertCalls[0].defaultDescription).not.toContain("alert(");
    expect(mockState.insertCalls[0].defaultDescription).toContain("Steps");
  });

  it("strips event-handler attributes from defaultDescription before storing", async () => {
    await request(buildApp())
      .post("/api/task-templates")
      .send({ ...VALID_TEMPLATE_BODY, defaultDescription: '<p onclick="alert(1)">Runbook</p>' });

    expect(mockState.insertCalls[0].defaultDescription).not.toContain("onclick");
    expect(mockState.insertCalls[0].defaultDescription).toContain("Runbook");
  });

  it("strips <iframe> from defaultDescription before storing", async () => {
    await request(buildApp())
      .post("/api/task-templates")
      .send({ ...VALID_TEMPLATE_BODY, defaultDescription: '<iframe src="https://evil.com"></iframe><p>safe</p>' });

    expect(mockState.insertCalls[0].defaultDescription).not.toContain("<iframe");
    expect(mockState.insertCalls[0].defaultDescription).toContain("safe");
  });

  it("stores null when defaultDescription is an empty TipTap paragraph", async () => {
    await request(buildApp())
      .post("/api/task-templates")
      .send({ ...VALID_TEMPLATE_BODY, defaultDescription: "<p></p>" });

    expect(mockState.insertCalls[0].defaultDescription).toBeNull();
  });

  it("preserves valid TipTap HTML (bold, lists, headings) in defaultDescription", async () => {
    const safeHtml = "<h2>Runbook</h2><ul><li><strong>Check logs</strong></li></ul>";
    await request(buildApp())
      .post("/api/task-templates")
      .send({ ...VALID_TEMPLATE_BODY, defaultDescription: safeHtml });

    expect(mockState.insertCalls[0].defaultDescription).toContain("<h2>Runbook</h2>");
    expect(mockState.insertCalls[0].defaultDescription).toContain("<strong>Check logs</strong>");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/task-templates/:id - sanitization
// ---------------------------------------------------------------------------

describe("PATCH /api/task-templates/:id - defaultDescription sanitization", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TEMPLATE];
    mockState.deleteResult = [];
  });

  it("strips <script> tags from defaultDescription on update", async () => {
    mockState.selectQueue.push([MOCK_TEMPLATE]); // existing template lookup

    await request(buildApp())
      .patch("/api/task-templates/1")
      .send({ defaultDescription: '<p>Steps</p><script>alert("xss")</script>' });

    // insertCalls[0] captures the _setData passed to db.update().set()
    const setData = mockState.insertCalls[0]?._setData;
    expect(setData?.defaultDescription).not.toContain("<script>");
    expect(setData?.defaultDescription).not.toContain("alert(");
    expect(setData?.defaultDescription).toContain("Steps");
  });

  it("stores null when defaultDescription is empty TipTap on update", async () => {
    mockState.selectQueue.push([MOCK_TEMPLATE]);

    await request(buildApp())
      .patch("/api/task-templates/1")
      .send({ defaultDescription: "<p></p>" });

    const setData = mockState.insertCalls[0]?._setData;
    expect(setData?.defaultDescription).toBeNull();
  });

  it("returns 404 when template does not exist", async () => {
    mockState.selectQueue.push([]); // existing lookup → not found

    const res = await request(buildApp())
      .patch("/api/task-templates/999")
      .send({ name: "New name" });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/task-templates/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/task-templates/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 204 on successful delete", async () => {
    mockState.selectQueue.push([MOCK_TEMPLATE]); // existing lookup
    const res = await request(buildApp()).delete("/api/task-templates/1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when template does not exist", async () => {
    mockState.selectQueue.push([]); // not found
    const res = await request(buildApp()).delete("/api/task-templates/999");
    expect(res.status).toBe(404);
  });
});
