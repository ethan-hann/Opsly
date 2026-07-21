import { Router, type IRouter } from "express";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db, commentsTable, tasksTable, orgMembersTable, usersTable, taskWatchersTable, commentReactionsTable, organizationsTable } from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentParams,
  ListCommentsParams,
  DeleteCommentParams,
  ListCommentsResponse,
  CreateCommentResponse,
  DeleteCommentResponse,
  UpdateCommentBody,
  UpdateCommentParams,
  UpdateCommentResponse,
  AddReactionParams,
  AddReactionBody,
  DeleteReactionParams,
  DEFAULT_REACTION_PALETTE,
} from "@workspace/api-zod";
import { requireOrgOrApiKey, requireScope, hasPermission, requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCommented } from "../lib/webhook-dispatcher";
import { resolveCustomFieldNames } from "../lib/resolve-custom-fields";
import { notifyCommentAdded, notifyMentions, notifyCommentReply } from "../lib/notifications";

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

  res.json(ListCommentsResponse.parse(comments.map(c => {
    const isDeleted = c.deletedAt != null;
    return {
      ...c,
      deleted: isDeleted,
      // Mask sensitive fields for soft-deleted comments so the client only
      // sees the tombstone flag — content, authorship, and reactions are hidden.
      content: isDeleted ? "" : c.content,
      author: isDeleted ? null : (c.author ?? null),
      userId: isDeleted ? null : c.userId,
      parentId: c.parentId ?? null,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
      editedAt: c.editedAt instanceof Date ? c.editedAt.toISOString() : (c.editedAt ?? null),
      reactions: isDeleted ? [] : (reactionsMap.get(c.id) ?? []),
    };
  })));
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

  // Validate parentId if provided; capture the parent author's userId so the
  // async notification block can send a reply notification without an extra query.
  let parentCommentUserId: string | null = null;
  if (parsed.data.parentId != null) {
    const [parent] = await db
      .select({ id: commentsTable.id, userId: commentsTable.userId })
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.id, parsed.data.parentId),
          eq(commentsTable.taskId, params.data.id),
          eq(commentsTable.orgId, orgId),
          isNull(commentsTable.deletedAt),
        ),
      )
      .limit(1);

    if (!parent) {
      res.status(404).json({ error: "Parent comment not found" });
      return;
    }

    parentCommentUserId = parent.userId ?? null;
  }

  // All newly created comments always have org_id and user_id set.
  const [comment] = await db
    .insert(commentsTable)
    .values({ ...parsed.data, taskId: params.data.id, orgId, userId: req.user?.id ?? null })
    .returning();

  const serializedComment = {
    ...comment,
    deleted: false,
    author: comment.author ?? null,
    parentId: comment.parentId ?? null,
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

      const actorId = req.user?.id ?? null;
      const actorName = req.user
        ? [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
          req.user.email ||
          "Someone"
        : "Someone";

      // ── Parse @mention tokens from the comment content ─────────────────────
      //
      // Token formats (documented here as the canonical reference):
      //   Individual:  @[<userId>:<Display Name>]
      //   Broadcast:   @[everyone]
      //
      // Each named user receives a `mention` notification.  @[everyone]
      // dispatches to every active org member except the commenter.
      // Mention recipients are excluded from the parallel `comment_added`
      // watcher notification so they never receive both.

      const mentionTokenRe = /@\[([^:\]]+):[^\]]*\]/g;
      const mentionedUserIds = new Set<string>();
      let mtMatch: RegExpExecArray | null;
      while ((mtMatch = mentionTokenRe.exec(comment.content)) !== null) {
        mentionedUserIds.add(mtMatch[1]);
      }
      const hasEveryoneMention = /@\[everyone\]/.test(comment.content);

      // Fetch all active org members when needed
      let orgMemberUserIds: string[] = [];
      if (hasEveryoneMention || mentionedUserIds.size > 0) {
        const allOrgMembers = await db
          .select({ userId: orgMembersTable.userId })
          .from(orgMembersTable)
          .where(eq(orgMembersTable.orgId, req.orgId!));
        orgMemberUserIds = allOrgMembers.map((m) => m.userId);
      }

      // Build the deduplicated set of mention notification targets
      const mentionTargets = new Set<string>();
      if (hasEveryoneMention) {
        for (const uid of orgMemberUserIds) {
          if (uid !== actorId) mentionTargets.add(uid);
        }
      } else {
        const orgMemberSet = new Set(orgMemberUserIds);
        for (const uid of mentionedUserIds) {
          if (orgMemberSet.has(uid) && uid !== actorId) {
            mentionTargets.add(uid);
          }
        }
      }

      if (mentionTargets.size > 0) {
        await notifyMentions({
          taskId: fullTask.id,
          taskTitle: fullTask.title,
          orgId: req.orgId!,
          actorId,
          actorName,
          recipientUserIds: [...mentionTargets],
        });
      }

      // ── Notify watchers — skip anyone who already got a mention ────────────
      const watcherRows = await db
        .select({ userId: taskWatchersTable.userId })
        .from(taskWatchersTable)
        .where(eq(taskWatchersTable.taskId, fullTask.id));

      const watcherIds = watcherRows
        .map((r) => r.userId)
        .filter((id) => !mentionTargets.has(id));

      if (watcherIds.length > 0) {
        await notifyCommentAdded({
          taskId: fullTask.id,
          taskTitle: fullTask.title,
          orgId: req.orgId!,
          actorId,
          actorName,
          recipientUserIds: [...new Set(watcherIds)],
        });
      }

      // ── Notify the parent comment's author if this is a reply ─────────────
      // parentCommentUserId is captured synchronously before the insert so no
      // extra DB round-trip is needed here.
      if (comment.parentId != null && parentCommentUserId && parentCommentUserId !== actorId) {
        await notifyCommentReply({
          taskId: fullTask.id,
          taskTitle: fullTask.title,
          orgId: req.orgId!,
          actorId,
          actorName,
          recipientUserId: parentCommentUserId,
        });
      }
    }
  })();

  res.status(201).json(CreateCommentResponse.parse(serializedComment));
});

// ─── Update (edit) comment ────────────────────────────────────────────────────
//
// Authorization matrix:
//   Session caller  — must be the comment author (userId match) OR have the
//                     edit_comments RBAC permission (Admin / Owner role).
//   API key caller  — requires comments:write scope; hasPermission() returns true
//                     for all API key requests, so the ownership check is bypassed.
//                     This lets automation tooling edit any comment in its org without
//                     needing the key to be the original author.

router.patch("/comments/:id", requireOrgOrApiKey, requireScope("comments:write"), async (req, res): Promise<void> => {
  const params = UpdateCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  const [comment] = await db
    .select({ id: commentsTable.id, userId: commentsTable.userId, taskId: commentsTable.taskId, orgId: commentsTable.orgId, parentId: commentsTable.parentId, author: commentsTable.author, content: commentsTable.content, createdAt: commentsTable.createdAt, deletedAt: commentsTable.deletedAt, editedAt: commentsTable.editedAt })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, params.data.id),
        eq(commentsTable.orgId, orgId),
        isNull(commentsTable.deletedAt),
      ),
    )
    .limit(1);

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const currentUserId = req.user?.id ?? null;
  const canEdit = hasPermission(req, "edit_comments");
  const isOwner = comment.userId != null && comment.userId === currentUserId;

  if (!isOwner && !canEdit) {
    res.status(403).json({ error: "You do not have permission to edit this comment" });
    return;
  }

  const body = UpdateCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(commentsTable)
    .set({ content: body.data.content, editedAt: now })
    .where(
      and(
        eq(commentsTable.id, params.data.id),
        eq(commentsTable.orgId, orgId),
        isNull(commentsTable.deletedAt),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const reactionsMap = await enrichWithReactions([{ id: updated.id }]);
  const serialized = {
    ...updated,
    deleted: false,
    author: updated.author ?? null,
    parentId: updated.parentId ?? null,
    createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : updated.createdAt,
    editedAt: updated.editedAt instanceof Date ? updated.editedAt.toISOString() : (updated.editedAt ?? null),
    reactions: reactionsMap.get(updated.id) ?? [],
  };

  res.json(UpdateCommentResponse.parse(serialized));
});

// ─── Delete comment ───────────────────────────────────────────────────────────

router.delete("/comments/:id", requireOrgOrApiKey, requireScope("comments:write"), async (req, res): Promise<void> => {
  const params = DeleteCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Fetch comment; exclude already-soft-deleted rows so they appear as 404
  // (idempotent from the caller's perspective).
  const [comment] = await db
    .select({ id: commentsTable.id, userId: commentsTable.userId })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.id, params.data.id),
        eq(commentsTable.orgId, orgId),
        isNull(commentsTable.deletedAt),
      ),
    )
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

  // Soft-delete: stamp deleted_at instead of removing the row. This preserves
  // child replies so threaded discussions remain coherent — the UI renders a
  // Reddit-style "This comment was deleted." tombstone in place of the content.
  // The isNull(deletedAt) predicate guards against a same-org race where
  // another request soft-deleted the row between our SELECT and UPDATE.
  const [softDeleted] = await db
    .update(commentsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(commentsTable.id, params.data.id),
        eq(commentsTable.orgId, orgId),
        isNull(commentsTable.deletedAt),
      ),
    )
    .returning({ id: commentsTable.id });

  if (!softDeleted) {
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
