import { Router } from "express";
import { db } from "@workspace/db";
import { notesTable, projectsTable, tasksTable } from "@workspace/db";
import { eq, and, or, ne, isNull } from "drizzle-orm";
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
import { addSseClient, broadcastNoteChange } from "../lib/notes-sse";

const router = Router();

function serializeNote(note: typeof notesTable.$inferSelect, userId: string) {
  return {
    ...note,
    isOwner: note.createdBy === null || note.createdBy === userId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** Visibility filter: own notes + legacy (no owner) + any non-private shared note */
function visibilityFilter(userId: string) {
  return or(
    isNull(notesTable.createdBy),
    eq(notesTable.createdBy, userId),
    ne(notesTable.visibility, "private"),
  );
}

async function validateProjectId(projectId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

async function validateTaskId(taskId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

// GET /notes/events - SSE stream for real-time note change notifications.
// Must be registered before /notes/:id so Express doesn't treat "events" as an id.
router.get("/notes/events", requireOrg, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx/proxy response buffering
  res.flushHeaders();

  // Initial comment keeps the connection alive through proxies that buffer headers.
  res.write(": connected\n\n");

  const orgId = req.orgId!;
  const remove = addSseClient(orgId, res);

  // Keepalive comment every 25 s so the connection survives idle-timeout proxies.
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    remove();
  });
});

// GET /notes
router.get("/notes", requireOrg, async (req, res) => {
  const query = ListNotesQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.message });
  }

  const userId = req.user!.id;
  const orgId = req.orgId!;

  const conditions = [eq(notesTable.orgId, orgId), visibilityFilter(userId)];
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

  return res.json(ListNotesResponse.parse(rows.map((n) => serializeNote(n, userId))));
});

// POST /notes
router.post("/notes", requireOrg, async (req, res) => {
  const body = CreateNoteBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.message });
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;

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
    .values({ ...body.data, orgId, createdBy: userId })
    .returning();

  broadcastNoteChange(orgId);
  return res.status(201).json(CreateNoteResponse.parse(serializeNote(note, userId)));
});

// GET /notes/:id
router.get("/notes/:id", requireOrg, async (req, res) => {
  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const userId = req.user!.id;

  const [note] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, req.orgId!)));

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  const isOwner = note.createdBy === null || note.createdBy === userId;
  if (!isOwner && note.visibility === "private") {
    return res.status(403).json({ error: "Access denied" });
  }

  return res.json(GetNoteResponse.parse(serializeNote(note, userId)));
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
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, orgId)));

  if (!existing) {
    return res.status(404).json({ error: "Note not found" });
  }

  const isOwner = existing.createdBy === null || existing.createdBy === userId;

  // Non-owners can only edit public_write notes (and cannot change visibility)
  if (!isOwner && existing.visibility !== "public_write") {
    return res.status(403).json({ error: "Access denied" });
  }
  if (!isOwner && body.data.visibility !== undefined) {
    return res.status(403).json({ error: "Only the note owner can change visibility" });
  }

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
  if (body.data.visibility !== undefined) updates.visibility = body.data.visibility;
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

  broadcastNoteChange(orgId);
  return res.json(UpdateNoteResponse.parse(serializeNote(note, userId)));
});

// DELETE /notes/:id - owner only
router.delete("/notes/:id", requireOrg, async (req, res) => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, req.orgId!)));

  if (!existing) {
    return res.status(404).json({ error: "Note not found" });
  }

  const isOwner = existing.createdBy === null || existing.createdBy === userId;
  if (!isOwner) {
    return res.status(403).json({ error: "Only the note owner can delete this note" });
  }

  await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, req.orgId!)));

  broadcastNoteChange(req.orgId!);
  return res.sendStatus(204);
});

export default router;
