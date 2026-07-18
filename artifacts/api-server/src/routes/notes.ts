import { Router } from "express";
import { db } from "@workspace/db";
import { notesTable, projectsTable, tasksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListNotesQueryParams,
  ListNotesResponse,
  CreateNoteBody,
  CreateNoteResponse,
  GetNoteParams,
  GetNoteResponse,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  DeleteNoteParams,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";

const router = Router();

function serializeNote(note: typeof notesTable.$inferSelect) {
  return {
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** Reject if projectId is provided but doesn't belong to orgId. */
async function validateProjectId(projectId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

/** Reject if taskId is provided but doesn't belong to orgId. */
async function validateTaskId(taskId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

// GET /notes
router.get("/notes", requireOrg, async (req, res) => {
  const query = ListNotesQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.message });
  }

  const conditions = [eq(notesTable.orgId, req.orgId!)];
  if (query.data.projectId !== undefined) {
    conditions.push(eq(notesTable.projectId, query.data.projectId));
  }
  if (query.data.taskId !== undefined) {
    conditions.push(eq(notesTable.taskId, query.data.taskId));
  }

  const rows = await db
    .select()
    .from(notesTable)
    .where(and(...conditions))
    .orderBy(notesTable.updatedAt);

  return res.json(ListNotesResponse.parse(rows.map(serializeNote)));
});

// POST /notes
router.post("/notes", requireOrg, async (req, res) => {
  const body = CreateNoteBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.message });
  }

  const orgId = req.orgId!;

  // Validate cross-tenant FK references
  if (body.data.projectId != null) {
    if (!(await validateProjectId(body.data.projectId, orgId))) {
      return res.status(400).json({ error: "Invalid projectId" });
    }
  }
  if (body.data.taskId != null) {
    if (!(await validateTaskId(body.data.taskId, orgId))) {
      return res.status(400).json({ error: "Invalid taskId" });
    }
  }

  const [note] = await db
    .insert(notesTable)
    .values({ ...body.data, orgId })
    .returning();

  return res.status(201).json(CreateNoteResponse.parse(serializeNote(note)));
});

// GET /notes/:id
router.get("/notes/:id", requireOrg, async (req, res) => {
  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const [note] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, req.orgId!)));

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.json(GetNoteResponse.parse(serializeNote(note)));
});

// PATCH /notes/:id
router.patch("/notes/:id", requireOrg, async (req, res) => {
  const params = UpdateNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const body = UpdateNoteBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.message });
  }

  const orgId = req.orgId!;

  // Validate cross-tenant FK references when being set to a non-null value
  if (body.data.projectId != null) {
    if (!(await validateProjectId(body.data.projectId, orgId))) {
      return res.status(400).json({ error: "Invalid projectId" });
    }
  }
  if (body.data.taskId != null) {
    if (!(await validateTaskId(body.data.taskId, orgId))) {
      return res.status(400).json({ error: "Invalid taskId" });
    }
  }

  const updates: Partial<typeof notesTable.$inferInsert> = {};
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.content !== undefined) updates.content = body.data.content;
  if ("projectId" in body.data) updates.projectId = body.data.projectId ?? null;
  if ("taskId" in body.data) updates.taskId = body.data.taskId ?? null;

  const [note] = await db
    .update(notesTable)
    .set(updates)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, orgId)))
    .returning();

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.json(UpdateNoteResponse.parse(serializeNote(note)));
});

// DELETE /notes/:id
router.delete("/notes/:id", requireOrg, async (req, res) => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const [deleted] = await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, req.orgId!)))
    .returning();

  if (!deleted) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.sendStatus(204);
});

export default router;
