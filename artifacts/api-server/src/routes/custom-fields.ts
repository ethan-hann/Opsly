import { Router, type IRouter } from "express";
import { eq, and, isNull, isNotNull, asc, sql } from "drizzle-orm";
import { db, customFieldDefinitionsTable, tasksTable, taskEventsTable } from "@workspace/db";
import {
  ListCustomFieldDefinitionsResponse,
  CreateCustomFieldDefinitionBody,
  CreateCustomFieldDefinitionResponse,
  UpdateCustomFieldDefinitionParams,
  UpdateCustomFieldDefinitionBody,
  UpdateCustomFieldDefinitionResponse,
  DeleteCustomFieldDefinitionParams,
  PurgeCustomFieldDefinitionParams,
  PurgeCustomFieldDefinitionResponse,
  RestoreCustomFieldDefinitionParams,
  RestoreCustomFieldDefinitionResponse,
  ReorderCustomFieldDefinitionsBody,
} from "@workspace/api-zod";
import { requireOrg, requireAdmin } from "../middlewares/requireOrgMiddleware";
import { requireOrgFeature } from "../lib/org-features";

const router: IRouter = Router();

const requireCustomFieldsFeature = requireOrgFeature('custom_fields');

/** Derive a human-readable display name from a user object. */
function actorDisplayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | undefined): string | null {
  if (!user) return null;
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full || user.email || "Unknown";
}

/** Serialize a DB row's Date fields to ISO strings for Zod response parsing. */
function serializeDef(def: typeof customFieldDefinitionsTable.$inferSelect) {
  return {
    ...def,
    deletedAt: def.deletedAt instanceof Date ? def.deletedAt.toISOString() : def.deletedAt,
    createdAt: def.createdAt instanceof Date ? def.createdAt.toISOString() : def.createdAt,
    updatedAt: def.updatedAt instanceof Date ? def.updatedAt.toISOString() : def.updatedAt,
  };
}

/** GET /custom-fields — list definitions for the org, ordered by position.
 *  Pass ?includeSoftDeleted=true to also receive soft-deleted definitions. */
router.get("/custom-fields", requireOrg, requireCustomFieldsFeature, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const includeSoftDeleted = req.query.includeSoftDeleted === "true";

  const whereClause = includeSoftDeleted
    ? eq(customFieldDefinitionsTable.orgId, orgId)
    : and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt));

  const definitions = await db
    .select()
    .from(customFieldDefinitionsTable)
    .where(whereClause)
    .orderBy(asc(customFieldDefinitionsTable.position), asc(customFieldDefinitionsTable.id));

  res.json(ListCustomFieldDefinitionsResponse.parse(definitions.map(serializeDef)));
});

/** POST /custom-fields — create a new field definition (admin only) */
router.post("/custom-fields", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
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
router.patch("/custom-fields/:id", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateCustomFieldDefinitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // A field's type is immutable after creation: changing it (e.g. number →
  // text) would silently invalidate every stored value on the next write.
  // Reject explicitly rather than silently stripping the property.
  if (req.body && typeof req.body === "object" && "type" in req.body) {
    res.status(409).json({
      error: "A custom field's type cannot be changed after creation. Delete the field and create a new one instead.",
    });
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
      .select({
        type: customFieldDefinitionsTable.type,
        options: customFieldDefinitionsTable.options,
        name: customFieldDefinitionsTable.name,
      })
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
        const removedSet = new Set(removedOptions);

        // Fetch affected tasks — their IDs and current customFields values.
        // This replaces a count-only query: the rows are needed both for the 409
        // payload (affectedTaskCount) and for writing audit events on force=true.
        let affectedTasks: Array<{ id: number; customFields: unknown }> = [];

        if (currentDef.type === "single_select") {
          affectedTasks = await db
            .select({ id: tasksTable.id, customFields: tasksTable.customFields })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.orgId, orgId),
                sql`${tasksTable.customFields}->>${fieldId} = ANY(${removedArr})`,
              ),
            );
        } else {
          // multi_select: fetch tasks whose array overlaps with the removed options.
          affectedTasks = await db
            .select({ id: tasksTable.id, customFields: tasksTable.customFields })
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
        }

        const affectedCount = affectedTasks.length;

        if (affectedCount > 0) {
          if (!parsed.data.force) {
            res.status(409).json({
              error: "One or more removed options are still in use by existing tasks",
              affectedTaskCount: affectedCount,
              affectedTaskIds: affectedTasks.map((t) => t.id),
            });
            return;
          }

          // force=true: clear stale values from affected tasks before saving.
          const actorId = req.user?.id ?? null;
          const actorName = actorDisplayName(req.user);
          // field identifier uses "cf:" prefix so the UI can distinguish custom-field
          // audit events from standard task-field events.
          const auditField = `cf:${currentDef.name}`;

          if (currentDef.type === "single_select") {
            await db.execute(sql`
              UPDATE tasks
              SET custom_fields = custom_fields - ${fieldId}
              WHERE org_id = ${orgId}
                AND custom_fields->>${fieldId} = ANY(${removedArr})
            `);

            // One audit event per task: records the old option value, cleared by admin.
            await db.insert(taskEventsTable).values(
              affectedTasks.map((task) => ({
                taskId: task.id,
                orgId,
                actorId,
                actorName,
                field: auditField,
                oldValue: String((task.customFields as Record<string, unknown>)[fieldId] ?? ""),
                newValue: null as null,
              })),
            );
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

            // One audit event per task: records old array and the filtered new array.
            await db.insert(taskEventsTable).values(
              affectedTasks.map((task) => {
                const oldArr: string[] = ((task.customFields as Record<string, unknown>)[fieldId] as string[]) ?? [];
                const newArr = oldArr.filter((v) => !removedSet.has(v));
                return {
                  taskId: task.id,
                  orgId,
                  actorId,
                  actorName,
                  field: auditField,
                  oldValue: JSON.stringify(oldArr),
                  newValue: newArr.length > 0 ? JSON.stringify(newArr) : null,
                };
              }),
            );
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
router.delete("/custom-fields/:id", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
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

/** POST /custom-fields/:id/restore — un-soft-delete a field (admin only) */
router.post("/custom-fields/:id/restore", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
  const params = RestoreCustomFieldDefinitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  const [def] = await db
    .update(customFieldDefinitionsTable)
    .set({ deletedAt: null })
    .where(
      and(
        eq(customFieldDefinitionsTable.id, params.data.id),
        eq(customFieldDefinitionsTable.orgId, orgId),
        isNotNull(customFieldDefinitionsTable.deletedAt),
      ),
    )
    .returning();

  if (!def) {
    res.status(404).json({ error: "Custom field not found, already active, or belongs to a different org" });
    return;
  }

  res.json(RestoreCustomFieldDefinitionResponse.parse(serializeDef(def)));
});

/** POST /custom-fields/:id/purge — hard-delete a field and erase all stored values (admin only) */
router.post("/custom-fields/:id/purge", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
  const params = PurgeCustomFieldDefinitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const fieldId = String(params.data.id);

  const result = await db.transaction(async (tx) => {
    // Confirm the field belongs to this org (soft-deleted or active — both can be purged).
    // Capture the field name now — it's needed for audit events and will be gone after deletion.
    const [existing] = await tx
      .select({ id: customFieldDefinitionsTable.id, name: customFieldDefinitionsTable.name })
      .from(customFieldDefinitionsTable)
      .where(
        and(
          eq(customFieldDefinitionsTable.id, params.data.id),
          eq(customFieldDefinitionsTable.orgId, orgId),
        ),
      )
      .limit(1);

    if (!existing) return null;

    // Fetch every task that carries a value for this field — need the id and stored
    // value so we can write one audit event per task before wiping the data.
    const affectedTasks = await tx
      .select({ id: tasksTable.id, customFields: tasksTable.customFields })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.orgId, orgId),
          sql`${tasksTable.customFields} ? ${fieldId}`,
        ),
      );

    const affectedTaskCount = affectedTasks.length;

    // Remove the field key from every task in a single UPDATE
    if (affectedTaskCount > 0) {
      await tx.execute(sql`
        UPDATE tasks
        SET custom_fields = custom_fields - ${fieldId}
        WHERE org_id = ${orgId}
          AND custom_fields ? ${fieldId}
      `);

      // Write one audit event per affected task so admins can see why the value
      // disappeared.  The field name is captured above before the definition is
      // deleted; the "cf:" prefix distinguishes custom-field events in the UI.
      const actorId = req.user?.id ?? null;
      const actorName = actorDisplayName(req.user);
      const auditField = `cf:${existing.name}`;

      await tx.insert(taskEventsTable).values(
        affectedTasks.map((task) => {
          const rawValue = (task.customFields as Record<string, unknown>)[fieldId];
          return {
            taskId: task.id,
            orgId,
            actorId,
            actorName,
            field: auditField,
            oldValue: JSON.stringify(rawValue),
            newValue: null as null,
          };
        }),
      );
    }

    // Hard-delete the field definition row
    await tx
      .delete(customFieldDefinitionsTable)
      .where(
        and(
          eq(customFieldDefinitionsTable.id, params.data.id),
          eq(customFieldDefinitionsTable.orgId, orgId),
        ),
      );

    return affectedTaskCount;
  });

  if (result === null) {
    res.status(404).json({ error: "Custom field not found" });
    return;
  }

  res.json(PurgeCustomFieldDefinitionResponse.parse({ deletedFieldId: params.data.id, affectedTaskCount: result }));
});

/** POST /custom-fields/reorder — reorder field definitions (admin only) */
router.post("/custom-fields/reorder", requireOrg, requireCustomFieldsFeature, requireAdmin, async (req, res): Promise<void> => {
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
