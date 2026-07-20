import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, commentsTable, tasksTable, orgMembersTable, usersTable, taskWatchersTable } from "@workspace/db";
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
import { resolveCustomFieldNames } from "../lib/resolve-custom-fields";
import { notifyCommentAdded } from "../lib/notifications";

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

  // All newly created comments always have org_id and user_id set.
  const [comment] = await db
    .insert(commentsTable)
    .values({ ...parsed.data, taskId: params.data.id, orgId, userId: req.user!.id })
    .returning();

  const serializedComment = {
    ...comment,
    author: comment.author ?? null,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
  };

  // Fire outbound webhook + in-app notifications async
  void (async () => {
    const [fullTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.id))
      .limit(1);
    if (fullTask) {
      const webhookCustomFields = await resolveCustomFieldNames(
        (fullTask.customFields as Record<string, unknown>) ?? {},
        req.orgId!,
      );
      dispatchTaskCommented(
        req.orgId!,
        fullTask.projectId,
        {
          ...fullTask,
          customFields: webhookCustomFields,
          createdAt: fullTask.createdAt.toISOString(),
          updatedAt: fullTask.updatedAt.toISOString(),
        },
        serializedComment,
      );

      // Notify all watchers (includes assignee if they're watching)
      const watcherRows = await db
        .select({ userId: taskWatchersTable.userId })
        .from(taskWatchersTable)
        .where(eq(taskWatchersTable.taskId, fullTask.id));

      const watcherIds = watcherRows.map((r) => r.userId);

      if (watcherIds.length > 0) {
        const actorId = req.user?.id ?? null;
        const actorName = req.user
          ? [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
            req.user.email ||
            "Someone"
          : "Someone";

        await notifyCommentAdded({
          taskId: fullTask.id,
          taskTitle: fullTask.title,
          orgId: req.orgId!,
          actorId,
          actorName,
          recipientUserIds: [...new Set(watcherIds)],
        });
      }
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
    .select({ id: commentsTable.id, userId: commentsTable.userId })
    .from(commentsTable)
    .where(and(eq(commentsTable.id, params.data.id), eq(commentsTable.orgId, orgId)))
    .limit(1);

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const currentUserId = req.user!.id;
  const isAdmin = req.orgPermissions?.manage_projects === true;
  const isOwner = comment.userId != null && comment.userId === currentUserId;

  // Allow deletion if: the requester created the comment, OR they are an org admin.
  // Comments with no userId (created before this column was added) may only be
  // deleted by org admins.
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "You do not have permission to delete this comment" });
    return;
  }

  // Include orgId in the DELETE predicate so that a racing concurrent request
  // from another org cannot delete this comment between our SELECT and DELETE.
  // Use RETURNING to detect a same-org race: if the comment was deleted by a
  // concurrent request between our SELECT and DELETE, no row is returned and
  // we respond 404 instead of silently returning 204.
  const [deleted] = await db.delete(commentsTable)
    .where(and(eq(commentsTable.id, params.data.id), eq(commentsTable.orgId, orgId)))
    .returning({ id: commentsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
