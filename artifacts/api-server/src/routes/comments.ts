import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, commentsTable, tasksTable, orgMembersTable, usersTable, taskWatchersTable, commentReactionsTable, organizationsTable } from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentParams,
  ListCommentsParams,
  DeleteCommentParams,
  ListCommentsResponse,
  CreateCommentResponse,
  DeleteCommentResponse,
  AddReactionParams,
  AddReactionBody,
  DeleteReactionParams,
  DEFAULT_REACTION_PALETTE,
} from "@workspace/api-zod";
import { requireOrgOrApiKey, requireScope, hasPermission, requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCommented } from "../lib/webhook-dispatcher";
import { resolveCustomFieldNames } from "../lib/resolve-custom-fields";
import { notifyCommentAdded } from "../lib/notifications";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the active reaction palette for an org.
 * If `reactionPalette` is set and non-empty, use it; otherwise use the default.
 */
async function getOrgPalette(orgId: string): Promise<string[]> {
  const [org] = await db
    .select({ reactionPalette: organizationsTable.reactionPalette })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);
  if (org?.reactionPalette && org.reactionPalette.length > 0) {
    return org.reactionPalette;
  }
  return DEFAULT_REACTION_PALETTE;
}

/**
 * Enrich a list of comments with their reaction summaries.
 */
async function enrichWithReactions(
  comments: Array<{ id: number }>,
): Promise<Map<number, Array<{ emoji: string; count: number; userIds: string[] }>>> {
  if (comments.length === 0) return new Map();

  const commentIds = comments.map((c) => c.id);
  const rows = await db
    .select({
      commentId: commentReactionsTable.commentId,
      emoji: commentReactionsTable.emoji,
      userId: commentReactionsTable.userId,
    })
    .from(commentReactionsTable)
    .where(inArray(commentReactionsTable.commentId, commentIds));

  // Group by commentId → emoji → userIds
  const byComment = new Map<number, Map<string, string[]>>();
  for (const row of rows) {
    if (!byComment.has(row.commentId)) byComment.set(row.commentId, new Map());
    const emojiMap = byComment.get(row.commentId)!;
    if (!emojiMap.has(row.emoji)) emojiMap.set(row.emoji, []);
    emojiMap.get(row.emoji)!.push(row.userId);
  }

  const result = new Map<number, Array<{ emoji: string; count: number; userIds: string[] }>>();
  for (const [commentId, emojiMap] of byComment) {
    result.set(
      commentId,
      Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
      })),
    );
  }
  return result;
}

// ─── List comments ────────────────────────────────────────────────────────────

router.get("/tasks/:id/comments", requireOrgOrApiKey, requireScope("comments:read"), async (req, res): Promise<void> => {
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

  const reactionsMap = await enrichWithReactions(comments);

  res.json(ListCommentsResponse.parse(comments.map(c => ({
    ...c,
    author: c.author ?? null,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    reactions: reactionsMap.get(c.id) ?? [],
  }))));
});

// ─── Create comment ───────────────────────────────────────────────────────────

router.post("/tasks/:id/comments", requireOrgOrApiKey, requireScope("comments:write"), async (req, res): Promise<void> => {
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
    .values({ ...parsed.data, taskId: params.data.id, orgId, userId: req.user?.id ?? null })
    .returning();

  const serializedComment = {
    ...comment,
    author: comment.author ?? null,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
    reactions: [],
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

// ─── Delete comment ───────────────────────────────────────────────────────────

router.delete("/comments/:id", requireOrgOrApiKey, requireScope("comments:write"), async (req, res): Promise<void> => {
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

  const currentUserId = req.user?.id ?? null;
  const isAdmin = hasPermission(req, "delete_comments");
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

// ─── Add reaction ─────────────────────────────────────────────────────────────

router.post(
  "/comments/:id/reactions",
  requireOrgOrApiKey,
  requireScope("comments:write"),
  async (req, res): Promise<void> => {
    const params = AddReactionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = AddReactionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const orgId = req.orgId!;
    const { emoji } = body.data;

    // Verify comment belongs to the org
    const [comment] = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(and(eq(commentsTable.id, params.data.id), eq(commentsTable.orgId, orgId)))
      .limit(1);

    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    // Validate emoji is in the org's active palette
    const palette = await getOrgPalette(orgId);
    if (!palette.includes(emoji)) {
      res.status(422).json({ error: "Emoji is not in the org's reaction palette" });
      return;
    }

    // Must be a session user to react
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Upsert — silently succeed if already reacted
    await db
      .insert(commentReactionsTable)
      .values({
        orgId,
        commentId: params.data.id,
        userId: req.user.id,
        emoji,
      })
      .onConflictDoNothing();

    res.json({ ok: true });
  },
);

// ─── Remove reaction ──────────────────────────────────────────────────────────

router.delete(
  "/comments/:id/reactions/:emoji",
  requireOrgOrApiKey,
  requireScope("comments:write"),
  async (req, res): Promise<void> => {
    const params = DeleteReactionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const orgId = req.orgId!;

    // Verify comment belongs to the org
    const [comment] = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(and(eq(commentsTable.id, params.data.id), eq(commentsTable.orgId, orgId)))
      .limit(1);

    if (!comment) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    await db
      .delete(commentReactionsTable)
      .where(
        and(
          eq(commentReactionsTable.commentId, params.data.id),
          eq(commentReactionsTable.userId, req.user.id),
          eq(commentReactionsTable.emoji, params.data.emoji),
        ),
      );

    res.json({ ok: true });
  },
);

export default router;
