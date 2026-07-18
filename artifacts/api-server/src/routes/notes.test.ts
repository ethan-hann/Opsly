/**
 * Tests for notes routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered regressions:
 *  - GET /notes — happy-path list
 *  - POST /notes — body validation, invalid projectId/taskId, 201 on success
 *  - GET /notes/:id — 404 on miss, 403 for private note accessed by non-owner, 200 for owner
 *  - PATCH /notes/:id — 404 on miss, 403 for non-owner on read-only/private notes,
 *                        403 when non-owner tries to change visibility, 200 for owner and public_write
 *  - DELETE /notes/:id — 404 on miss, 403 for non-owner, 204 for owner
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
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockState.updateResult),
          }),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
    notesTable: {},
    projectsTable: {},
    tasksTable: {},
    orgMembersTable: {},
    commentsTable: {},
    usersTable: {},
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    ne: () => ({}),
    isNull: () => ({}),
    sql: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));

// The middleware also injects req.user since notes routes use req.user!.id.
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    next();
  },
}));

import notesRouter from "./notes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", notesRouter);
  return app;
}

/** A note owned by the requesting user (user-owner). */
const OWNER_NOTE = {
  id: 1,
  orgId: "test-org",
  title: "My private note",
  content: "Secret stuff",
  visibility: "private",
  createdBy: "user-owner",
  projectId: null,
  taskId: null,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

/** A note owned by someone else, marked private. */
const OTHER_PRIVATE_NOTE = {
  ...OWNER_NOTE,
  id: 2,
  title: "Someone else's private note",
  content: "None of your business",
  createdBy: "other-user",
  visibility: "private",
};

/** A note owned by someone else, open for public editing. */
const OTHER_PUBLIC_WRITE_NOTE = {
  ...OWNER_NOTE,
  id: 3,
  title: "Shared editable note",
  content: "Collaborate here",
  createdBy: "other-user",
  visibility: "public_write",
};

/** A note owned by someone else, read-only public. */
const OTHER_PUBLIC_READ_NOTE = {
  ...OWNER_NOTE,
  id: 4,
  title: "Shared read-only note",
  content: "Visible but locked",
  createdBy: "other-user",
  visibility: "public_read",
};

// ---------------------------------------------------------------------------
// GET /api/notes
// ---------------------------------------------------------------------------

describe("GET /api/notes", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 200 with an empty array when there are no notes", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/notes");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with serialized notes including isOwner", async () => {
    mockState.selectQueue.push([OWNER_NOTE]);

    const res = await request(buildApp()).get("/api/notes");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      title: "My private note",
      isOwner: true,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/notes
// ---------------------------------------------------------------------------

describe("POST /api/notes", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 400 for an invalid projectId that is not in the org", async () => {
    // validateProjectId select returns empty → invalid
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Note", content: "Body", projectId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/projectId/i) });
  });

  it("returns 400 for an invalid taskId that is not in the org", async () => {
    // validateTaskId select returns empty → invalid
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Note", content: "Body", taskId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/taskId/i) });
  });

  it("returns 201 with the created note on success", async () => {
    mockState.insertResult = [OWNER_NOTE];

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "My private note", content: "Secret stuff" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      title: "My private note",
      isOwner: true,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/notes/:id
// ---------------------------------------------------------------------------

describe("GET /api/notes/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 404 when the note does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/notes/1");

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-owner accesses a private note", async () => {
    mockState.selectQueue.push([OTHER_PRIVATE_NOTE]);

    const res = await request(buildApp()).get("/api/notes/2");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/access denied/i) });
  });

  it("returns 200 for the owner accessing their own private note", async () => {
    mockState.selectQueue.push([OWNER_NOTE]);

    const res = await request(buildApp()).get("/api/notes/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, isOwner: true });
  });

  it("returns 200 for a non-owner accessing a public_read note", async () => {
    mockState.selectQueue.push([OTHER_PUBLIC_READ_NOTE]);

    const res = await request(buildApp()).get("/api/notes/4");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 4, isOwner: false });
  });

  it("returns 400 for a non-integer note id", async () => {
    const res = await request(buildApp()).get("/api/notes/not-a-number");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notes/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/notes/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 404 when the note does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/notes/1")
      .send({ title: "New title" });

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-owner tries to edit a private note", async () => {
    mockState.selectQueue.push([OTHER_PRIVATE_NOTE]);

    const res = await request(buildApp())
      .patch("/api/notes/2")
      .send({ title: "Sneaky edit" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when a non-owner tries to edit a public_read note", async () => {
    mockState.selectQueue.push([OTHER_PUBLIC_READ_NOTE]);

    const res = await request(buildApp())
      .patch("/api/notes/4")
      .send({ content: "Overwrite" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when a non-owner tries to change visibility on a public_write note", async () => {
    mockState.selectQueue.push([OTHER_PUBLIC_WRITE_NOTE]);

    const res = await request(buildApp())
      .patch("/api/notes/3")
      .send({ visibility: "private" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/visibility/i) });
  });

  it("returns 200 when a non-owner edits content on a public_write note", async () => {
    const updated = { ...OTHER_PUBLIC_WRITE_NOTE, content: "New content" };
    mockState.selectQueue.push([OTHER_PUBLIC_WRITE_NOTE]);
    mockState.updateResult = [updated];

    const res = await request(buildApp())
      .patch("/api/notes/3")
      .send({ content: "New content" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, isOwner: false });
  });

  it("returns 200 when the owner updates their note", async () => {
    const updated = { ...OWNER_NOTE, title: "Updated title" };
    mockState.selectQueue.push([OWNER_NOTE]);
    mockState.updateResult = [updated];

    const res = await request(buildApp())
      .patch("/api/notes/1")
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: "Updated title", isOwner: true });
  });

  it("returns 200 when the owner changes visibility", async () => {
    const updated = { ...OWNER_NOTE, visibility: "public_read" };
    mockState.selectQueue.push([OWNER_NOTE]);
    mockState.updateResult = [updated];

    const res = await request(buildApp())
      .patch("/api/notes/1")
      .send({ visibility: "public_read" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, visibility: "public_read", isOwner: true });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/notes/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/notes/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 404 when the note does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/notes/1");

    expect(res.status).toBe(404);
  });

  it("returns 403 when a non-owner tries to delete a note", async () => {
    mockState.selectQueue.push([OTHER_PRIVATE_NOTE]);

    const res = await request(buildApp()).delete("/api/notes/2");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/owner/i) });
  });

  it("returns 403 when a non-owner tries to delete a public_write note", async () => {
    // Even public_write notes can only be deleted by their owner.
    mockState.selectQueue.push([OTHER_PUBLIC_WRITE_NOTE]);

    const res = await request(buildApp()).delete("/api/notes/3");

    expect(res.status).toBe(403);
  });

  it("returns 204 when the owner deletes their note", async () => {
    mockState.selectQueue.push([OWNER_NOTE]);

    const res = await request(buildApp()).delete("/api/notes/1");

    expect(res.status).toBe(204);
  });

  it("returns 400 for a non-integer note id", async () => {
    const res = await request(buildApp()).delete("/api/notes/bad-id");
    expect(res.status).toBe(400);
  });
});
