import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commentsTable } from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentParams,
  ListCommentsParams,
  DeleteCommentParams,
  ListCommentsResponse,
  CreateCommentResponse,
  DeleteCommentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tasks/:id/comments", async (req, res): Promise<void> => {
  const params = ListCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const comments = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.taskId, params.data.id))
    .orderBy(commentsTable.createdAt);

  res.json(ListCommentsResponse.parse(comments.map(c => ({
    ...c,
    author: c.author ?? null,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  }))));
});

router.post("/tasks/:id/comments", async (req, res): Promise<void> => {
  const params = CreateCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [comment] = await db
    .insert(commentsTable)
    .values({ ...parsed.data, taskId: params.data.id })
    .returning();

  res.status(201).json(CreateCommentResponse.parse({
    ...comment,
    author: comment.author ?? null,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
  }));
});

router.delete("/comments/:id", async (req, res): Promise<void> => {
  const params = DeleteCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [comment] = await db
    .delete(commentsTable)
    .where(eq(commentsTable.id, params.data.id))
    .returning();

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
