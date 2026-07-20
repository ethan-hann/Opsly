import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, taskTemplatesTable } from "@workspace/db";
import {
  ListTaskTemplatesResponse,
  CreateTaskTemplateBody,
  CreateTaskTemplateResponse,
  UpdateTaskTemplateParams,
  UpdateTaskTemplateBody,
  UpdateTaskTemplateResponse,
  DeleteTaskTemplateParams,
} from "@workspace/api-zod";
import { requireOrg, requirePermission } from "../middlewares/requireOrgMiddleware";
import { sanitizeRichText } from "../lib/sanitize-rich-text";

const router: IRouter = Router();

function serializeTemplate(t: typeof taskTemplatesTable.$inferSelect) {
  return {
    ...t,
    defaultDescription: t.defaultDescription ?? null,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  };
}

/** GET /task-templates — list all templates for the org */
router.get("/task-templates", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const templates = await db
    .select()
    .from(taskTemplatesTable)
    .where(eq(taskTemplatesTable.orgId, orgId))
    .orderBy(taskTemplatesTable.createdAt);

  res.json(ListTaskTemplatesResponse.parse(templates.map(serializeTemplate)));
});

/** POST /task-templates — create a template (admin only) */
router.post("/task-templates", requireOrg, requirePermission("manage_task_templates"), async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = CreateTaskTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .insert(taskTemplatesTable)
    .values({
      orgId,
      createdBy: userId,
      name: parsed.data.name,
      defaultTitle: parsed.data.defaultTitle ?? "",
      defaultPriority: parsed.data.defaultPriority ?? "medium",
      defaultCategory: parsed.data.defaultCategory ?? "other",
      defaultDescription: sanitizeRichText(parsed.data.defaultDescription ?? null),
    })
    .returning();

  res.status(201).json(CreateTaskTemplateResponse.parse(serializeTemplate(template)));
});

/** PATCH /task-templates/:id — update a template (admin only) */
router.patch("/task-templates/:id", requireOrg, requirePermission("manage_task_templates"), async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const params = UpdateTaskTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(taskTemplatesTable)
    .where(and(eq(taskTemplatesTable.id, params.data.id), eq(taskTemplatesTable.orgId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const updateData: Partial<typeof taskTemplatesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.defaultTitle !== undefined) updateData.defaultTitle = parsed.data.defaultTitle;
  if (parsed.data.defaultPriority !== undefined) updateData.defaultPriority = parsed.data.defaultPriority;
  if (parsed.data.defaultCategory !== undefined) updateData.defaultCategory = parsed.data.defaultCategory;
  if ("defaultDescription" in parsed.data) updateData.defaultDescription = sanitizeRichText(parsed.data.defaultDescription ?? null);

  const [updated] = await db
    .update(taskTemplatesTable)
    .set(updateData)
    .where(and(eq(taskTemplatesTable.id, params.data.id), eq(taskTemplatesTable.orgId, orgId)))
    .returning();

  res.json(UpdateTaskTemplateResponse.parse(serializeTemplate(updated)));
});

/** DELETE /task-templates/:id — delete a template (admin only) */
router.delete("/task-templates/:id", requireOrg, requirePermission("manage_task_templates"), async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const params = DeleteTaskTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(taskTemplatesTable)
    .where(and(eq(taskTemplatesTable.id, params.data.id), eq(taskTemplatesTable.orgId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  await db
    .delete(taskTemplatesTable)
    .where(and(eq(taskTemplatesTable.id, params.data.id), eq(taskTemplatesTable.orgId, orgId)));

  res.status(204).send();
});

export default router;
