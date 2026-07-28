import { Router } from "express";
import { db } from "@workspace/db";
import { notesTable, projectsTable, tasksTable } from "@workspace/db";
import { eq, and, or, ne, isNull, sql } from "drizzle-orm";
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
import { addSseClient } from "../lib/notes-sse";
import { dispatchNoteCreated, dispatchNoteUpdated, dispatchNoteDeleted } from "../lib/webhook-dispatcher";
import { broadcastToOrg } from "../lib/sse";

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

type NoteReferenceValidationRow = {
  projectId: number | null;
  taskId: number | null;
  taskProjectId: number | null;
};

async function getNoteReferenceValidationRow(
  orgId: string,
  taskId: number | null,
  projectId: number | null,
): Promise<NoteReferenceValidationRow> {
  const result = await db.execute(sql`
    SELECT
      project_match.id AS "projectId",
      task_match.id AS "taskId",
      task_match.project_id AS "taskProjectId"
    FROM (SELECT 1) AS base
    LEFT JOIN (
      SELECT id
      FROM projects
      WHERE org_id = ${orgId}
        AND id = ${projectId}
      LIMIT 1
    ) AS project_match ON TRUE
    LEFT JOIN (
      SELECT id, project_id
      FROM tasks
      WHERE org_id = ${orgId}
        AND id = ${taskId}
      LIMIT 1
    ) AS task_match ON TRUE
  `);

  const [row] = result.rows as NoteReferenceValidationRow[];
  return row ?? { projectId: null, taskId: null, taskProjectId: null };
}

/**
 * Returns the effective project ID for webhook dispatch.
 * Uses note.projectId when set; falls back to the linked task's projectId so
 * that project-filtered webhooks fire even when a note is linked only via a task.
 */
async function resolveEffectiveProjectId(note: {
  projectId: number | null;
  taskId: number | null;
}, orgId: string): Promise<number | null> {
  if (note.projectId != null) return note.projectId;
  if (note.taskId == null) return null;
  const [row] = await db
    .select({ projectId: tasksTable.projectId })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, note.taskId), eq(tasksTable.orgId, orgId)))
    .limit(1);
  return row?.projectId ?? null;
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

  if (body.data.projectId != null || body.data.taskId != null) {
    const validation = await getNoteReferenceValidationRow(
      orgId,
      body.data.taskId ?? null,
      body.data.projectId ?? null,
    );

    if (body.data.projectId != null && validation.projectId == null) {
      return res.status(400).json({ error: "Invalid projectId" });
    }
    if (body.data.taskId != null && validation.taskId == null) {
      return res.status(400).json({ error: "Invalid taskId" });
    }
    if (
      body.data.projectId != null &&
      body.data.taskId != null &&
      validation.taskProjectId !== body.data.projectId
    ) {
      return res.status(400).json({ error: "Task does not belong to the specified project" });
    }
  }

  const [note] = await db
    .insert(notesTable)
    .values({ ...body.data, orgId, createdBy: userId })
    .returning();

  broadcastToOrg(orgId, "notes-changed", {});
  dispatchNoteCreated(orgId, await resolveEffectiveProjectId(note, req.orgId!), serializeNote(note, userId));
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

  // Determine the effective resulting projectId and taskId after the patch is
  // applied, then cross-check them if both are non-null.
  const effectiveProjectId =
    "projectId" in body.data ? (body.data.projectId ?? null) : existing.projectId;
  const effectiveTaskId =
    "taskId" in body.data ? (body.data.taskId ?? null) : existing.taskId;

  const shouldValidateProject = body.data.projectId != null;
  const shouldValidateTask = body.data.taskId != null;
  const shouldValidateTaskProjectRelation =
    effectiveProjectId != null && effectiveTaskId != null;

  if (shouldValidateProject || shouldValidateTask || shouldValidateTaskProjectRelation) {
    const validation = await getNoteReferenceValidationRow(
      orgId,
      effectiveTaskId,
      effectiveProjectId,
    );

    if (shouldValidateProject && validation.projectId == null) {
      return res.status(400).json({ error: "Invalid projectId" });
    }
    if (shouldValidateTask && validation.taskId == null) {
      return res.status(400).json({ error: "Invalid taskId" });
    }
    if (
      shouldValidateTaskProjectRelation &&
      validation.taskProjectId !== effectiveProjectId
    ) {
      return res.status(400).json({ error: "Task does not belong to the specified project" });
    }
  }

  const updates: Partial<typeof notesTable.$inferInsert> = {};
  if (body.data.title !== undefined) updates.title = body.data.title;
  if (body.data.content !== undefined) updates.content = body.data.content;
  if (body.data.visibility !== undefined) updates.visibility = body.data.visibility;
  if ("projectId" in body.data) updates.projectId = body.data.projectId ?? null;
  if ("taskId" in body.data) updates.taskId = body.data.taskId ?? null;

  // Capture the effective project before the update so we can notify webhooks
  // that were watching the old project if the note is being re-assigned.
  const oldEffectiveProjectId = await resolveEffectiveProjectId(existing, req.orgId!);

  const [note] = await db
    .update(notesTable)
    .set(updates)
    .where(and(eq(notesTable.id, params.data.id), eq(notesTable.orgId, orgId)))
    .returning();

  if (!note) {
    return res.status(404).json({ error: "Note not found" });
  }

  const newEffectiveProjectId = await resolveEffectiveProjectId(note, req.orgId!);
  const serialized = serializeNote(note, userId);

  broadcastToOrg(orgId, "notes-changed", {});

  // If the note moved between projects, also notify project-specific webhooks
  // watching the old project so they learn the note left their scope.
  // We use projectSpecificOnly=true here so that org-wide webhooks are skipped
  // for this "leaving" notification — they will receive exactly one delivery
  // from the second dispatch below (for the new project).
  if (
    oldEffectiveProjectId !== newEffectiveProjectId &&
    oldEffectiveProjectId != null
  ) {
    dispatchNoteUpdated(orgId, oldEffectiveProjectId, serialized, true);
  }
  dispatchNoteUpdated(orgId, newEffectiveProjectId, serialized);

  return res.json(UpdateNoteResponse.parse(serialized));
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

  broadcastToOrg(req.orgId!, "notes-changed", {});
  dispatchNoteDeleted(req.orgId!, await resolveEffectiveProjectId(existing, req.orgId!), serializeNote(existing, userId));
  return res.sendStatus(204);
});

export default router;
