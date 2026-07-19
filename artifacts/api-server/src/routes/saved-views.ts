import { Router, type IRouter } from "express";
import { eq, and, or } from "drizzle-orm";
import { db, savedViewsTable } from "@workspace/db";
import {
  ListViewsResponse,
  CreateViewBody,
  CreateViewResponse,
  UpdateViewParams,
  UpdateViewBody,
  UpdateViewResponse,
  DeleteViewParams,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

/** Serialize Date fields to ISO strings */
function serializeView(view: typeof savedViewsTable.$inferSelect) {
  return {
    ...view,
    createdAt: view.createdAt instanceof Date ? view.createdAt.toISOString() : view.createdAt,
    updatedAt: view.updatedAt instanceof Date ? view.updatedAt.toISOString() : view.updatedAt,
  };
}

/** GET /views — list views visible to the caller (personal + org-wide) */
router.get("/views", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const views = await db
    .select()
    .from(savedViewsTable)
    .where(
      and(
        eq(savedViewsTable.orgId, orgId),
        or(
          eq(savedViewsTable.createdBy, userId),
          eq(savedViewsTable.isOrgWide, true),
        ),
      ),
    )
    .orderBy(savedViewsTable.createdAt);

  res.json(ListViewsResponse.parse(views.map(serializeView)));
});

/** POST /views — create a new saved view */
router.post("/views", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { name, filters, isOrgWide = false, isDefault = false } = parsed.data;

  // If this is being set as default, clear any existing default for this user in this org
  if (isDefault) {
    await db
      .update(savedViewsTable)
      .set({ isDefault: false })
      .where(
        and(
          eq(savedViewsTable.orgId, orgId),
          eq(savedViewsTable.createdBy, userId),
          eq(savedViewsTable.isDefault, true),
        ),
      );
  }

  const [view] = await db
    .insert(savedViewsTable)
    .values({
      orgId,
      createdBy: userId,
      name,
      filters: filters ?? {},
      isOrgWide,
      isDefault,
    })
    .returning();

  res.status(201).json(CreateViewResponse.parse(serializeView(view)));
});

/** PATCH /views/:id — update a saved view (owner or admin only) */
router.patch("/views/:id", requireOrg, async (req, res): Promise<void> => {
  const params = UpdateViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user?.id;
  const canAdmin = req.orgPermissions?.manage_org_settings ?? false;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Load the existing view
  const [existing] = await db
    .select()
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.id, params.data.id), eq(savedViewsTable.orgId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "View not found" });
    return;
  }

  // Only creator or admin can edit
  if (existing.createdBy !== userId && !canAdmin) {
    res.status(403).json({ error: "Only the view owner or an org admin can edit this view" });
    return;
  }

  const updates: Partial<typeof savedViewsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.filters !== undefined) updates.filters = parsed.data.filters;
  if (parsed.data.isOrgWide !== undefined) updates.isOrgWide = parsed.data.isOrgWide;
  if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault;

  // If pinning as default, clear any previous default for this user
  if (parsed.data.isDefault === true) {
    await db
      .update(savedViewsTable)
      .set({ isDefault: false })
      .where(
        and(
          eq(savedViewsTable.orgId, orgId),
          eq(savedViewsTable.createdBy, existing.createdBy),
          eq(savedViewsTable.isDefault, true),
        ),
      );
  }

  const [view] = await db
    .update(savedViewsTable)
    .set(updates)
    .where(and(eq(savedViewsTable.id, params.data.id), eq(savedViewsTable.orgId, orgId)))
    .returning();

  if (!view) {
    res.status(404).json({ error: "View not found" });
    return;
  }

  res.json(UpdateViewResponse.parse(serializeView(view)));
});

/** DELETE /views/:id — delete a saved view (owner or admin only) */
router.delete("/views/:id", requireOrg, async (req, res): Promise<void> => {
  const params = DeleteViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user?.id;
  const canAdmin = req.orgPermissions?.manage_org_settings ?? false;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Load the view to check ownership
  const [existing] = await db
    .select()
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.id, params.data.id), eq(savedViewsTable.orgId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "View not found" });
    return;
  }

  if (existing.createdBy !== userId && !canAdmin) {
    res.status(403).json({ error: "Only the view owner or an org admin can delete this view" });
    return;
  }

  await db
    .delete(savedViewsTable)
    .where(and(eq(savedViewsTable.id, params.data.id), eq(savedViewsTable.orgId, orgId)));

  res.sendStatus(204);
});

export default router;
