import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, commentsTable, tasksTable } from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentParams,
  ListCommentsParams,
  DeleteCommentParams,
  ListCommentsResponse,
  CreateCommentResponse,
  DeleteCommentResponse,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCommented } from "../lib/webhook-dispatcher";

const router: IRouter = Router();

router.get("/tasks/:id/comments", requireOrg, async (req, res): Promise<void> => {
  const params = ListCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Verify task belongs to the org
  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const comments = await db
    .select()
    .from(commentsTable)
    .where(and(eq(commentsTable.taskId, params.data.id), eq(commentsTable.orgId, orgId)))
    .orderBy(commentsTable.createdAt);

  res.json(ListCommentsResponse.parse(comments.map(c => ({
    ...c,
    author: c.author ?? null,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  }))));
});

router.post("/tasks/:id/comments", requireOrg, async (req, res): Promise<void> => {
  const params = CreateCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Verify task belongs to the org
  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // All newly created comments always have org_id set (no NULL for new rows)
  const [comment] = await db
    .insert(commentsTable)
    .values({ ...parsed.data, taskId: params.data.id, orgId })
    .returning();

  const serializedComment = {
    ...comment,
    author: comment.author ?? null,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
  };

  // Fire outbound webhook async — fetch full task for payload
  void (async () => {
    const [fullTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id)).limit(1);
    if (fullTask) {
      dispatchTaskCommented(req.orgId!, fullTask.projectId, {
        ...fullTask,
        createdAt: fullTask.createdAt.toISOString(),
        updatedAt: fullTask.updatedAt.toISOString(),
      }, serializedComment);
    }
  })();

  res.status(201).json(CreateCommentResponse.parse(serializedComment));
});

router.delete("/comments/:id", requireOrg, async (req, res): Promise<void> => {
  const params = DeleteCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  const [comment] = await db
    .select({ id: commentsTable.id })
    .from(commentsTable)
    .where(and(eq(commentsTable.id, params.data.id), eq(commentsTable.orgId, orgId)))
    .limit(1);

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  await db.delete(commentsTable).where(eq(commentsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
