import { Router, type IRouter } from "express";
import { eq, and, isNull, asc } from "drizzle-orm";
import { db, customFieldDefinitionsTable } from "@workspace/db";
import {
  ListCustomFieldDefinitionsResponse,
  CreateCustomFieldDefinitionBody,
  CreateCustomFieldDefinitionResponse,
  UpdateCustomFieldDefinitionParams,
  UpdateCustomFieldDefinitionBody,
  UpdateCustomFieldDefinitionResponse,
  DeleteCustomFieldDefinitionParams,
  ReorderCustomFieldDefinitionsBody,
} from "@workspace/api-zod";
import { requireOrg, requireAdmin } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

/** Serialize a DB row's Date fields to ISO strings for Zod response parsing. */
function serializeDef(def: typeof customFieldDefinitionsTable.$inferSelect) {
  return {
    ...def,
    deletedAt: def.deletedAt instanceof Date ? def.deletedAt.toISOString() : def.deletedAt,
    createdAt: def.createdAt instanceof Date ? def.createdAt.toISOString() : def.createdAt,
    updatedAt: def.updatedAt instanceof Date ? def.updatedAt.toISOString() : def.updatedAt,
  };
}

/** GET /custom-fields — list non-deleted definitions for the org, ordered by position */
router.get("/custom-fields", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const definitions = await db
    .select()
    .from(customFieldDefinitionsTable)
    .where(and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt)))
    .orderBy(asc(customFieldDefinitionsTable.position), asc(customFieldDefinitionsTable.id));

  res.json(ListCustomFieldDefinitionsResponse.parse(definitions.map(serializeDef)));
});

/** POST /custom-fields — create a new field definition (admin only) */
router.post("/custom-fields", requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateCustomFieldDefinitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Assign the next position
  const existing = await db
    .select({ position: customFieldDefinitionsTable.position })
    .from(customFieldDefinitionsTable)
    .where(and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt)))
    .orderBy(asc(customFieldDefinitionsTable.position));

  const nextPosition = existing.length > 0
    ? Math.max(...existing.map((r) => r.position)) + 1
    : 0;

  const { name, type, options } = parsed.data;

  const [def] = await db
    .insert(customFieldDefinitionsTable)
    .values({ orgId, name, type, options: options ?? null, position: nextPosition })
    .returning();

  res.status(201).json(CreateCustomFieldDefinitionResponse.parse(serializeDef(def)));
});

/** PATCH /custom-fields/:id — update a field definition (admin only) */
router.patch("/custom-fields/:id", requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateCustomFieldDefinitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCustomFieldDefinitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  const updates: Partial<typeof customFieldDefinitionsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.options !== undefined) updates.options = parsed.data.options;

  const [def] = await db
    .update(customFieldDefinitionsTable)
    .set(updates)
    .where(
      and(
        eq(customFieldDefinitionsTable.id, params.data.id),
        eq(customFieldDefinitionsTable.orgId, orgId),
        isNull(customFieldDefinitionsTable.deletedAt),
      ),
    )
    .returning();

  if (!def) {
    res.status(404).json({ error: "Custom field not found" });
    return;
  }

  res.json(UpdateCustomFieldDefinitionResponse.parse(serializeDef(def)));
});

/** DELETE /custom-fields/:id — soft-delete a field definition (admin only) */
router.delete("/custom-fields/:id", requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteCustomFieldDefinitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  const [def] = await db
    .update(customFieldDefinitionsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(customFieldDefinitionsTable.id, params.data.id),
        eq(customFieldDefinitionsTable.orgId, orgId),
        isNull(customFieldDefinitionsTable.deletedAt),
      ),
    )
    .returning();

  if (!def) {
    res.status(404).json({ error: "Custom field not found" });
    return;
  }

  res.sendStatus(204);
});

/** POST /custom-fields/reorder — reorder field definitions (admin only) */
router.post("/custom-fields/reorder", requireOrg, requireAdmin, async (req, res): Promise<void> => {
  const parsed = ReorderCustomFieldDefinitionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const { ids } = parsed.data;

  // Update each definition's position to match the provided order
  await Promise.all(
    ids.map((id, index) =>
      db
        .update(customFieldDefinitionsTable)
        .set({ position: index })
        .where(
          and(
            eq(customFieldDefinitionsTable.id, id),
            eq(customFieldDefinitionsTable.orgId, orgId),
          ),
        ),
    ),
  );

  res.sendStatus(204);
});

export default router;
