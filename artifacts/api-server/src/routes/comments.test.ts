/**
 * Tests for comments routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered regressions:
 *  - GET /tasks/:id/comments — org-scoping (task must belong to org), 404 on miss
 *  - POST /tasks/:id/comments — org-scoping, body validation, 201 on success
 *  - DELETE /comments/:id — cross-org guard (comment→task→org), 404 on miss/mismatch, 204 on success
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
      limit: () => Promise.resolve(result),
      orderBy: () => Promise.resolve(result),
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
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
    commentsTable: {},
    tasksTable: {},
    orgMembersTable: {},
    projectsTable: {},
    notesTable: {},
    usersTable: {},
    eq: () => ({}),
    and: () => ({}),
    sql: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  sql: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    next();
  },
}));

import commentsRouter from "./comments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", commentsRouter);
  return app;
}

const MOCK_TASK = { id: 1 };

const MOCK_COMMENT = {
  id: 1,
  taskId: 1,
  content: "Looks good to me",
  author: "alice@example.com",
  createdAt: "2024-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/comments", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
  });

  it("returns 404 when the task does not belong to the org", async () => {
    // Task lookup returns empty — task not found in this org.
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 200 with an empty array when the task has no comments", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found
    mockState.selectQueue.push([]);           // no comments

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the comment list when comments exist", async () => {
    mockState.selectQueue.push([MOCK_TASK]);        // task found
    mockState.selectQueue.push([MOCK_COMMENT]);     // one comment

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      taskId: 1,
      content: "Looks good to me",
    });
  });

  it("returns 400 for a non-integer task id", async () => {
    const res = await request(buildApp()).get("/api/tasks/not-a-number/comments");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
  });

  it("returns 404 when the task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not found

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Hello" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when content is missing", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when content is an empty string", async () => {
    mockState.selectQueue.push([MOCK_TASK]);

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "" });

    expect(res.status).toBe(400);
  });

  it("returns 201 with the created comment on success", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found
    mockState.insertResult = [MOCK_COMMENT];

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Looks good to me", author: "alice@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      taskId: 1,
      content: "Looks good to me",
      author: "alice@example.com",
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/comments/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
  });

  it("returns 404 when the comment does not exist", async () => {
    mockState.selectQueue.push([]); // comment lookup → not found

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(404);
  });

  it("returns 404 when the comment's task belongs to a different org", async () => {
    // Comment found, but task lookup returns empty (wrong org).
    mockState.selectQueue.push([{ id: 1, taskId: 1 }]); // comment
    mockState.selectQueue.push([]);                       // task not in org

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(404);
  });

  it("returns 204 on successful delete", async () => {
    mockState.selectQueue.push([{ id: 1, taskId: 1 }]); // comment
    mockState.selectQueue.push([MOCK_TASK]);               // task in org

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(204);
  });

  it("returns 400 for a non-integer comment id", async () => {
    const res = await request(buildApp()).delete("/api/comments/bad-id");
    expect(res.status).toBe(400);
  });
});
