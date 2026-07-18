import { Router } from "express";
import { db } from "@workspace/db";
import { notesTable } from "@workspace/db";
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

const router = Router();

function serializeNote(note: typeof notesTable.$inferSelect) {
  return {
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

// GET /notes
router.get("/notes", async (req, res) => {
  const query = ListNotesQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.message });
  }

  const conditions = [];
  if (query.data.projectId !== undefined) {
    conditions.push(eq(notesTable.projectId, query.data.projectId));
  }
  if (query.data.taskId !== undefined) {
    conditions.push(eq(notesTable.taskId, query.data.taskId));
  }

  const rows = conditions.length > 0
    ? await db.select().from(notesTable).where(and(...conditions)).orderBy(notesTable.updatedAt)
    : await db.select().from(notesTable).orderBy(notesTable.updatedAt);

  const notes = rows.map(serializeNote);
  return res.json(ListNotesResponse.parse(notes));
});

// POST /notes
router.post("/notes", async (req, res) => {
  const body = CreateNoteBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.message });
  }

  const [note] = await db
    .insert(notesTable)
    .values({
      title: body.data.title ?? "Untitled Note",
      content: body.data.content ?? "",
      projectId: body.data.projectId ?? null,
      taskId: body.data.taskId ?? null,
    })
    .returning();

  return res.status(201).json(CreateNoteResponse.parse(serializeNote(note)));
});

// GET /notes/:id
router.get("/notes/:id", async (req, res) => {
  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const [note] = await db
    .select()
    .from(notesTable)
    .where(eq(notesTable.id, params.data.id));

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.json(GetNoteResponse.parse(serializeNote(note)));
});

// PATCH /notes/:id
router.patch("/notes/:id", async (req, res) => {
  const params = UpdateNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const body = UpdateNoteBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.message });
  }

  const updates: Partial<typeof notesTable.$inferInsert> = {};
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.content !== undefined) updates.content = body.data.content;
  if ("projectId" in body.data) updates.projectId = body.data.projectId ?? null;
  if ("taskId" in body.data) updates.taskId = body.data.taskId ?? null;

  const [note] = await db
    .update(notesTable)
    .set(updates)
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.json(UpdateNoteResponse.parse(serializeNote(note)));
});

// DELETE /notes/:id
router.delete("/notes/:id", async (req, res) => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: params.error.message });
  }

  const [deleted] = await db
    .delete(notesTable)
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    return res.status(404).json({ error: "Note not found" });
  }

  return res.sendStatus(204);
});

export default router;
