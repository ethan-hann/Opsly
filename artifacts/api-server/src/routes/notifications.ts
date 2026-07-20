/**
 * In-app notification API routes.
 *
 * GET  /notifications               — list notifications for the current user
 * POST /notifications/read-all      — mark all as read
 * PATCH /notifications/:id/read     — mark one as read
 * DELETE /notifications/:id         — dismiss one notification
 *
 * GET  /notification-preferences    — get per-type preferences
 * PATCH /notification-preferences   — update per-type preferences
 */

import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  emailDigestPreferencesTable,
} from "@workspace/db";
import {
  ListNotificationsQueryParams,
  ListNotificationsResponse,
  MarkAllReadResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  DeleteNotificationParams,
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferencesBody,
  UpdateNotificationPreferencesResponse,
  NotificationTypeEnum,
} from "../lib/notification-schemas";
import { requireOrg } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

// ─── GET /notifications ───────────────────────────────────────────────────────

router.get("/notifications", requireOrg, async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.user!.id;
  const orgId = req.orgId!;
  const { limit, offset, unreadOnly } = parsed.data;

  const conditions = [
    eq(notificationsTable.userId, userId),
    eq(notificationsTable.orgId, orgId),
  ];
  if (unreadOnly) conditions.push(eq(notificationsTable.read, false));

  const [rows, [{ total }], [{ unreadCount }]] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(...conditions)),

    db
      .select({ unreadCount: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.orgId, orgId),
          eq(notificationsTable.read, false),
        ),
      ),
  ]);

  const serialized = rows.map((n) => ({
    ...n,
    actorId: n.actorId ?? null,
    actorName: n.actorName ?? null,
    createdAt:
      n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
  }));

  res.json(
    ListNotificationsResponse.parse({
      notifications: serialized,
      unreadCount,
      total,
    }),
  );
});

// ─── POST /notifications/read-all ─────────────────────────────────────────────

router.post(
  "/notifications/read-all",
  requireOrg,
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const orgId = req.orgId!;

    const result = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.orgId, orgId),
          eq(notificationsTable.read, false),
        ),
      )
      .returning({ id: notificationsTable.id });

    res.json(MarkAllReadResponse.parse({ updated: result.length }));
  },
);

// ─── PATCH /notifications/:id/read ────────────────────────────────────────────

router.patch(
  "/notifications/:id/read",
  requireOrg,
  async (req, res): Promise<void> => {
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const userId = req.user!.id;
    const orgId = req.orgId!;

    const [updated] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.id, params.data.id),
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.orgId, orgId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(
      MarkNotificationReadResponse.parse({
        ...updated,
        actorId: updated.actorId ?? null,
        actorName: updated.actorName ?? null,
        createdAt:
          updated.createdAt instanceof Date
            ? updated.createdAt.toISOString()
            : updated.createdAt,
      }),
    );
  },
);

// ─── DELETE /notifications/:id ────────────────────────────────────────────────

router.delete(
  "/notifications/:id",
  requireOrg,
  async (req, res): Promise<void> => {
    const params = DeleteNotificationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const userId = req.user!.id;
    const orgId = req.orgId!;

    const [deleted] = await db
      .delete(notificationsTable)
      .where(
        and(
          eq(notificationsTable.id, params.data.id),
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.orgId, orgId),
        ),
      )
      .returning({ id: notificationsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.status(204).send();
  },
);

// ─── GET /notification-preferences ───────────────────────────────────────────

router.get(
  "/notification-preferences",
  requireOrg,
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const orgId = req.orgId!;

    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.userId, userId),
          eq(notificationPreferencesTable.orgId, orgId),
        ),
      )
      .orderBy(asc(notificationPreferencesTable.eventType));

    // Fill in defaults for types that have no row (opt-out model → missing = enabled)
    const storedMap = new Map(rows.map((r) => [r.eventType, r.enabled]));
    const allTypes = NotificationTypeEnum.options;

    const prefs = allTypes.map((eventType) => ({
      eventType,
      enabled: storedMap.get(eventType) ?? true,
    }));

    res.json(GetNotificationPreferencesResponse.parse(prefs));
  },
);

// ─── PATCH /notification-preferences ─────────────────────────────────────────

router.patch(
  "/notification-preferences",
  requireOrg,
  async (req, res): Promise<void> => {
    const parsed = UpdateNotificationPreferencesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = req.user!.id;
    const orgId = req.orgId!;

    // Upsert each preference
    await Promise.all(
      parsed.data.map(({ eventType, enabled }) =>
        db
          .insert(notificationPreferencesTable)
          .values({ userId, orgId, eventType, enabled })
          .onConflictDoUpdate({
            target: [
              notificationPreferencesTable.userId,
              notificationPreferencesTable.orgId,
              notificationPreferencesTable.eventType,
            ],
            set: { enabled },
          }),
      ),
    );

    // Re-fetch to return canonical state
    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.userId, userId),
          eq(notificationPreferencesTable.orgId, orgId),
        ),
      )
      .orderBy(asc(notificationPreferencesTable.eventType));

    const storedMap = new Map(rows.map((r) => [r.eventType, r.enabled]));
    const allTypes = NotificationTypeEnum.options;
    const prefs = allTypes.map((eventType) => ({
      eventType,
      enabled: storedMap.get(eventType) ?? true,
    }));

    res.json(UpdateNotificationPreferencesResponse.parse(prefs));
  },
);

// ─── GET /email-digest-preference ────────────────────────────────────────────

/**
 * GET /api/email-digest-preference
 * Return the current user's email digest frequency (none | daily | weekly).
 */
router.get("/email-digest-preference", requireOrg, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [pref] = await db
    .select({ frequency: emailDigestPreferencesTable.frequency })
    .from(emailDigestPreferencesTable)
    .where(eq(emailDigestPreferencesTable.userId, userId))
    .limit(1);

  res.json({ frequency: pref?.frequency ?? "none" });
});

// ─── PATCH /email-digest-preference ──────────────────────────────────────────

/**
 * PATCH /api/email-digest-preference
 * Update the current user's email digest frequency.
 * Body: { frequency: "none" | "daily" | "weekly" }
 */
router.patch("/email-digest-preference", requireOrg, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { frequency } = req.body as { frequency?: string };

  if (!["none", "daily", "weekly"].includes(frequency ?? "")) {
    res.status(400).json({ error: 'frequency must be "none", "daily", or "weekly"' });
    return;
  }

  await db
    .insert(emailDigestPreferencesTable)
    .values({ userId, frequency: frequency as "none" | "daily" | "weekly" })
    .onConflictDoUpdate({
      target: [emailDigestPreferencesTable.userId],
      set: { frequency: frequency as "none" | "daily" | "weekly", updatedAt: new Date() },
    });

  res.json({ frequency });
});

export default router;
