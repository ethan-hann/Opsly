/**
 * Tests for notes routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered regressions:
 *  - GET /notes - happy-path list
 *  - POST /notes - body validation, invalid projectId/taskId, 201 on success
 *  - GET /notes/:id - 404 on miss, 403 for private note accessed by non-owner, 200 for owner
 *  - PATCH /notes/:id - 404 on miss, 403 for non-owner on read-only/private notes,
 *                        403 when non-owner tries to change visibility, 200 for owner and public_write
 *  - DELETE /notes/:id - 404 on miss, 403 for non-owner, 204 for owner
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Mock } from "vitest";

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
    workflowStagesTable: {},
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
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    next();
  },
}));

// Dispatch helpers are fire-and-forget; mock them so they don't hit the DB.
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchNoteCreated: vi.fn(),
  dispatchNoteUpdated: vi.fn(),
  dispatchNoteDeleted: vi.fn(),
}));

// SSE broadcaster — no-op in tests.
vi.mock("../lib/notes-sse", () => ({
  addSseClient: vi.fn(),
  broadcastNoteChange: vi.fn(),
}));

import notesRouter from "./notes.js";
import {
  dispatchNoteCreated,
  dispatchNoteUpdated,
  dispatchNoteDeleted,
} from "../lib/webhook-dispatcher";

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

/** A note linked to a task (no direct project link). */
const TASK_LINKED_NOTE = {
  ...OWNER_NOTE,
  id: 5,
  title: "Task-linked note",
  taskId: 7,
  projectId: null,
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

  it("dispatches note.created with the task's projectId when note has taskId but no projectId", async () => {
    // validateTaskId → task found
    mockState.selectQueue.push([{ id: 7 }]);
    mockState.insertResult = [TASK_LINKED_NOTE];
    // resolveEffectiveProjectId → task has projectId 42
    mockState.selectQueue.push([{ projectId: 42 }]);

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Task-linked note", content: "Body", taskId: 7 });

    expect(res.status).toBe(201);
    expect(vi.mocked(dispatchNoteCreated as Mock)).toHaveBeenCalledWith(
      "test-org",
      42,
      expect.objectContaining({ taskId: 7 }),
    );
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
    vi.clearAllMocks();
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

  it("dispatches note.updated with the task's projectId when updated note has taskId but no projectId", async () => {
    // find existing note
    mockState.selectQueue.push([TASK_LINKED_NOTE]);
    const updated = { ...TASK_LINKED_NOTE, title: "Retitled" };
    mockState.updateResult = [updated];
    // resolveEffectiveProjectId is called twice: once for the old note, once for
    // the updated note. Both have taskId=7 so both need the same task row.
    mockState.selectQueue.push([{ projectId: 42 }]); // old note resolve
    mockState.selectQueue.push([{ projectId: 42 }]); // updated note resolve

    const res = await request(buildApp())
      .patch("/api/notes/5")
      .send({ title: "Retitled" });

    expect(res.status).toBe(200);
    expect(vi.mocked(dispatchNoteUpdated as Mock)).toHaveBeenCalledWith(
      "test-org",
      42,
      expect.objectContaining({ taskId: 7 }),
    );
  });

  it("dispatches to old project with projectSpecificOnly=true when note moves projects", async () => {
    // Note starts linked to project 10 directly
    const noteInProject10 = { ...OWNER_NOTE, id: 9, projectId: 10, taskId: null };
    mockState.selectQueue.push([noteInProject10]);
    // validateProjectId(20) needs to return a truthy row
    mockState.selectQueue.push([{ id: 20 }]);
    // updated note moves to project 20
    const updatedNote = { ...noteInProject10, projectId: 20 };
    mockState.updateResult = [updatedNote];
    // resolveEffectiveProjectId for both: projectId is set directly on the note,
    // so it returns early without a DB call.

    const res = await request(buildApp())
      .patch("/api/notes/9")
      .send({ projectId: 20 });

    expect(res.status).toBe(200);

    const calls = vi.mocked(dispatchNoteUpdated as Mock).mock.calls;
    // Old project call: projectSpecificOnly=true so org-wide subscribers are skipped
    const oldProjectCall = calls.find(
      ([, pid, , specificOnly]) => pid === 10 && specificOnly === true,
    );
    expect(oldProjectCall).toBeDefined();
    // New project call: normal dispatch (org-wide subscribers get exactly one delivery)
    const newProjectCall = calls.find(
      ([, pid, , specificOnly]) => pid === 20 && !specificOnly,
    );
    expect(newProjectCall).toBeDefined();
    // Org-wide webhooks should NOT receive a call with the old project id
    const orgWideOldProjectCall = calls.find(
      ([, pid, , specificOnly]) => pid === 10 && !specificOnly,
    );
    expect(orgWideOldProjectCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/notes — cross-project validation
// ---------------------------------------------------------------------------

describe("POST /api/notes — task/project cross-validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
  });

  it("returns 400 when the task belongs to a different project (wrong-project)", async () => {
    // validateProjectId → found
    mockState.selectQueue.push([{ id: 5 }]);
    // validateTaskId → found (task is in this org)
    mockState.selectQueue.push([{ id: 11 }]);
    // validateTaskBelongsToProject → not found (wrong project)
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Note", content: "Body", projectId: 5, taskId: 11 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/project/i) });
  });

  it("returns 400 when the task belongs to another org (rejected by individual task-org check)", async () => {
    // validateProjectId → found
    mockState.selectQueue.push([{ id: 5 }]);
    // validateTaskId → not found (task is in a different org)
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Note", content: "Body", projectId: 5, taskId: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/taskId/i) });
  });

  it("returns 201 when both projectId and taskId match the same project", async () => {
    // validateProjectId → found
    mockState.selectQueue.push([{ id: 5 }]);
    // validateTaskId → found
    mockState.selectQueue.push([{ id: 11 }]);
    // validateTaskBelongsToProject → found
    mockState.selectQueue.push([{ id: 11 }]);
    // insert + resolveEffectiveProjectId (note has directprojectId so no extra select)
    mockState.insertResult = [{ ...OWNER_NOTE, projectId: 5, taskId: 11 }];

    const res = await request(buildApp())
      .post("/api/notes")
      .send({ title: "Note", content: "Body", projectId: 5, taskId: 11 });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notes/:id — cross-project validation
// ---------------------------------------------------------------------------

describe("PATCH /api/notes/:id — task/project cross-validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    vi.clearAllMocks();
  });

  it("returns 400 when adding a projectId that doesn't match the note's existing taskId", async () => {
    // Existing note has taskId:7, no direct project
    mockState.selectQueue.push([TASK_LINKED_NOTE]);
    // validateProjectId(99) → found
    mockState.selectQueue.push([{ id: 99 }]);
    // validateTaskBelongsToProject(taskId=7, projectId=99) → not found
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/notes/5")
      .send({ projectId: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/project/i) });
  });

  it("returns 400 when patching a taskId that belongs to another org", async () => {
    // Existing note has no task/project
    mockState.selectQueue.push([OWNER_NOTE]);
    // validateTaskId → not found (wrong org)
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/notes/1")
      .send({ taskId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/taskId/i) });
  });

  it("returns 400 when patch's effective values (existing projectId + new taskId) mismatch", async () => {
    const noteWithProject = { ...OWNER_NOTE, id: 10, projectId: 1, taskId: null };
    // Existing note has projectId:1, no taskId
    mockState.selectQueue.push([noteWithProject]);
    // validateTaskId(99) → found
    mockState.selectQueue.push([{ id: 99 }]);
    // validateTaskBelongsToProject(taskId=99, projectId=1) → not found
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/notes/10")
      .send({ taskId: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/project/i) });
  });

  it("succeeds (200) when patching taskId to null — clears constraint, no cross-check needed", async () => {
    const noteWithBoth = { ...OWNER_NOTE, id: 11, projectId: 1, taskId: 7 };
    // Existing note has projectId:1, taskId:7
    mockState.selectQueue.push([noteWithBoth]);
    // taskId is null in body → validateTaskId skipped
    // effective taskId is null → cross-check skipped
    // resolveEffectiveProjectId: projectId set directly, no extra select
    mockState.updateResult = [{ ...noteWithBoth, taskId: null }];

    const res = await request(buildApp())
      .patch("/api/notes/11")
      .send({ taskId: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taskId: null });
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

  it("dispatches note.deleted with the task's projectId when note has taskId but no projectId", async () => {
    // find existing note
    mockState.selectQueue.push([TASK_LINKED_NOTE]);
    // resolveEffectiveProjectId → task has projectId 42
    mockState.selectQueue.push([{ projectId: 42 }]);

    const res = await request(buildApp()).delete("/api/notes/5");

    expect(res.status).toBe(204);
    expect(vi.mocked(dispatchNoteDeleted as Mock)).toHaveBeenCalledWith(
      "test-org",
      42,
      expect.objectContaining({ taskId: 7 }),
    );
  });

  it("returns 400 for a non-integer note id", async () => {
    const res = await request(buildApp()).delete("/api/notes/bad-id");
    expect(res.status).toBe(400);
  });
});
