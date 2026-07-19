import { Router, type IRouter } from "express";
import { eq, and, isNull, asc, sql } from "drizzle-orm";
import { db, customFieldDefinitionsTable, tasksTable } from "@workspace/db";
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

  // ── Option-removal conflict guard ─────────────────────────────────────────
  // When options are being updated for a single_select or multi_select field,
  // detect whether any tasks still store a value that would be orphaned. Reject
  // with 409 unless `force: true` is supplied, in which case stale task values
  // are cleared atomically before the options list is updated.
  if (parsed.data.options !== undefined) {
    const [currentDef] = await db
      .select({ type: customFieldDefinitionsTable.type, options: customFieldDefinitionsTable.options })
      .from(customFieldDefinitionsTable)
      .where(
        and(
          eq(customFieldDefinitionsTable.id, params.data.id),
          eq(customFieldDefinitionsTable.orgId, orgId),
          isNull(customFieldDefinitionsTable.deletedAt),
        ),
      )
      .limit(1);

    if (currentDef && (currentDef.type === "single_select" || currentDef.type === "multi_select")) {
      const currentOptions = (currentDef.options as string[]) ?? [];
      const removedOptions = currentOptions.filter((o) => !parsed.data.options!.includes(o));

      if (removedOptions.length > 0) {
        const fieldId = String(params.data.id);
        // Build a safe parameterised ARRAY[...] expression for the removed values.
        const removedArr = sql`ARRAY[${sql.join(removedOptions.map((o) => sql`${o}`), sql`, `)}]`;

        let affectedCount = 0;

        if (currentDef.type === "single_select") {
          const [row] = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.orgId, orgId),
                sql`${tasksTable.customFields}->>${fieldId} = ANY(${removedArr})`,
              ),
            );
          affectedCount = row?.count ?? 0;
        } else {
          // multi_select: check if the stored JSON array overlaps with removed options.
          const [row] = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.orgId, orgId),
                sql`${tasksTable.customFields} ? ${fieldId}`,
                sql`jsonb_typeof(${tasksTable.customFields}->${fieldId}) = 'array'`,
                sql`EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(${tasksTable.customFields}->${fieldId}) AS elem
                  WHERE elem = ANY(${removedArr})
                )`,
              ),
            );
          affectedCount = row?.count ?? 0;
        }

        if (affectedCount > 0) {
          if (!parsed.data.force) {
            res.status(409).json({
              error: "One or more removed options are still in use by existing tasks",
              affectedTaskCount: affectedCount,
            });
            return;
          }

          // force=true: clear stale values from affected tasks before saving.
          if (currentDef.type === "single_select") {
            await db.execute(sql`
              UPDATE tasks
              SET custom_fields = custom_fields - ${fieldId}
              WHERE org_id = ${orgId}
                AND custom_fields->>${fieldId} = ANY(${removedArr})
            `);
          } else {
            // Filter each task's multi_select array to only retain valid options.
            await db.execute(sql`
              UPDATE tasks
              SET custom_fields = jsonb_set(
                custom_fields,
                ${`{${fieldId}}`},
                COALESCE(
                  (SELECT jsonb_agg(elem)
                   FROM jsonb_array_elements_text(custom_fields->${fieldId}) AS elem
                   WHERE elem != ALL(${removedArr})),
                  '[]'::jsonb
                )
              )
              WHERE org_id = ${orgId}
                AND custom_fields ? ${fieldId}
                AND jsonb_typeof(custom_fields->${fieldId}) = 'array'
                AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(custom_fields->${fieldId}) AS elem
                  WHERE elem = ANY(${removedArr})
                )
            `);
          }
        }
      }
    }
  }
  // ── End conflict guard ────────────────────────────────────────────────────

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
