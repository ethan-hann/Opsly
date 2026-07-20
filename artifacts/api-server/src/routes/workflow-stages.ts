import { Router, type IRouter } from "express";
import { eq, and, asc, isNull, isNotNull, sql } from "drizzle-orm";
import { db, workflowStagesTable, tasksTable } from "@workspace/db";
import {
  ListWorkflowStagesResponse,
  CreateWorkflowStageBody,
  CreateWorkflowStageResponse,
  UpdateWorkflowStageParams,
  UpdateWorkflowStageBody,
  UpdateWorkflowStageResponse,
  RemoveWorkflowStageParams,
  ReorderWorkflowStagesBody,
} from "@workspace/api-zod";
import { requireOrg, requirePermission } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

function serializeStage(stage: typeof workflowStagesTable.$inferSelect) {
  return {
    ...stage,
    archivedAt: stage.archivedAt instanceof Date ? stage.archivedAt.toISOString() : (stage.archivedAt ?? null),
    createdAt: stage.createdAt instanceof Date ? stage.createdAt.toISOString() : stage.createdAt,
    updatedAt: stage.updatedAt instanceof Date ? stage.updatedAt.toISOString() : stage.updatedAt,
  };
}

/**
 * GET /workflow-stages — list all stages for the org (active first, then archived).
 * Available to all org members.
 */
router.get("/workflow-stages", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const stages = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.orgId, orgId))
    .orderBy(asc(workflowStagesTable.position), asc(workflowStagesTable.id));

  res.json(ListWorkflowStagesResponse.parse(stages.map(serializeStage)));
});

/**
 * POST /workflow-stages — create a new stage (admin only).
 * Appended at the end of the position list.
 */
router.post(
  "/workflow-stages",
  requireOrg,
  requirePermission("manage_workflow_stages"),
  async (req, res): Promise<void> => {
    const parsed = CreateWorkflowStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const orgId = req.orgId!;

    // Assign the next position (max existing + 1)
    const [{ maxPos }] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(${workflowStagesTable.position}), -1)` })
      .from(workflowStagesTable)
      .where(eq(workflowStagesTable.orgId, orgId));

    const [stage] = await db
      .insert(workflowStagesTable)
      .values({
        orgId,
        name: parsed.data.name,
        color: parsed.data.color ?? "#6b7280",
        type: parsed.data.type ?? "open",
        position: (maxPos ?? -1) + 1,
      })
      .returning();

    res.status(201).json(CreateWorkflowStageResponse.parse(serializeStage(stage)));
  },
);

/**
 * POST /workflow-stages/reorder — reorder stages by specifying the full ordered ID list.
 * Must be registered BEFORE /workflow-stages/:id to avoid the param catching it.
 */
router.post(
  "/workflow-stages/reorder",
  requireOrg,
  requirePermission("manage_workflow_stages"),
  async (req, res): Promise<void> => {
    const parsed = ReorderWorkflowStagesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const orgId = req.orgId!;
    const { ids } = parsed.data;

    await Promise.all(
      ids.map((id, index) =>
        db
          .update(workflowStagesTable)
          .set({ position: index })
          .where(and(eq(workflowStagesTable.id, id), eq(workflowStagesTable.orgId, orgId))),
      ),
    );

    res.sendStatus(204);
  },
);

/**
 * PATCH /workflow-stages/:id — update name, color, type, or archive/restore a stage.
 */
router.patch(
  "/workflow-stages/:id",
  requireOrg,
  requirePermission("manage_workflow_stages"),
  async (req, res): Promise<void> => {
    const params = UpdateWorkflowStageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateWorkflowStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const orgId = req.orgId!;

    // Verify the stage belongs to this org
    const [existing] = await db
      .select()
      .from(workflowStagesTable)
      .where(and(eq(workflowStagesTable.id, params.data.id), eq(workflowStagesTable.orgId, orgId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Workflow stage not found" });
      return;
    }

    const setData: Partial<typeof workflowStagesTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) setData.name = parsed.data.name;
    if (parsed.data.color !== undefined) setData.color = parsed.data.color;
    if (parsed.data.type !== undefined) {
      // Enforce at least one open and one closed stage when changing type
      const otherStages = await db
        .select({ type: workflowStagesTable.type })
        .from(workflowStagesTable)
        .where(
          and(
            eq(workflowStagesTable.orgId, orgId),
            isNull(workflowStagesTable.archivedAt),
            sql`${workflowStagesTable.id} != ${params.data.id}`,
          ),
        );

      const otherTypes = new Set(otherStages.map((s) => s.type));
      const newType = parsed.data.type;
      const otherType = newType === "open" ? "closed" : "open";
      if (!otherTypes.has(otherType)) {
        res.status(409).json({
          error: `Cannot change type: the org must have at least one '${otherType}' stage`,
        });
        return;
      }
      setData.type = newType;
    }
    if (parsed.data.archived !== undefined) {
      if (parsed.data.archived) {
        // Archiving: ensure at least 1 non-archived stage of each type remains
        const otherActive = await db
          .select({ type: workflowStagesTable.type })
          .from(workflowStagesTable)
          .where(
            and(
              eq(workflowStagesTable.orgId, orgId),
              isNull(workflowStagesTable.archivedAt),
              sql`${workflowStagesTable.id} != ${params.data.id}`,
            ),
          );
        const openCount = otherActive.filter((s) => s.type === "open").length;
        const closedCount = otherActive.filter((s) => s.type === "closed").length;
        if (existing.type === "open" && openCount === 0) {
          res.status(409).json({ error: "Cannot archive: at least one active 'open' stage is required" });
          return;
        }
        if (existing.type === "closed" && closedCount === 0) {
          res.status(409).json({ error: "Cannot archive: at least one active 'closed' stage is required" });
          return;
        }
        setData.archivedAt = new Date();
      } else {
        setData.archivedAt = null;
      }
    }

    const [updated] = await db
      .update(workflowStagesTable)
      .set(setData)
      .where(and(eq(workflowStagesTable.id, params.data.id), eq(workflowStagesTable.orgId, orgId)))
      .returning();

    res.json(UpdateWorkflowStageResponse.parse(serializeStage(updated)));
  },
);

/**
 * DELETE /workflow-stages/:id — permanently delete a stage.
 * Requires a `reassignTo` stage ID; all tasks currently in the deleted stage
 * are reassigned before deletion. Enforces minimum stage count.
 */
router.delete(
  "/workflow-stages/:id",
  requireOrg,
  requirePermission("manage_workflow_stages"),
  async (req, res): Promise<void> => {
    const params = RemoveWorkflowStageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const orgId = req.orgId!;
    const stageId = params.data.id;
    const reassignTo = req.query.reassignTo ? Number(req.query.reassignTo) : undefined;

    // Fetch the stage being deleted
    const [stage] = await db
      .select()
      .from(workflowStagesTable)
      .where(and(eq(workflowStagesTable.id, stageId), eq(workflowStagesTable.orgId, orgId)))
      .limit(1);

    if (!stage) {
      res.status(404).json({ error: "Workflow stage not found" });
      return;
    }

    // Count active stages of same type (excluding this one)
    const otherActive = await db
      .select({ type: workflowStagesTable.type, id: workflowStagesTable.id })
      .from(workflowStagesTable)
      .where(
        and(
          eq(workflowStagesTable.orgId, orgId),
          isNull(workflowStagesTable.archivedAt),
          sql`${workflowStagesTable.id} != ${stageId}`,
        ),
      );

    const sameTypeCount = otherActive.filter((s) => s.type === stage.type).length;
    if (sameTypeCount === 0) {
      res.status(409).json({
        error: `Cannot delete: at least one active '${stage.type}' stage must remain`,
      });
      return;
    }

    // Check if any tasks use this stage
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(and(eq(tasksTable.orgId, orgId), eq(tasksTable.status, String(stageId))));

    if (count > 0) {
      if (!reassignTo) {
        res.status(409).json({
          error: `${count} task(s) use this stage. Provide a 'reassignTo' query param with a target stage ID.`,
          affectedCount: count,
        });
        return;
      }

      // Validate the reassignment target belongs to this org
      const [target] = await db
        .select({ id: workflowStagesTable.id })
        .from(workflowStagesTable)
        .where(and(eq(workflowStagesTable.id, reassignTo), eq(workflowStagesTable.orgId, orgId)))
        .limit(1);

      if (!target) {
        res.status(400).json({ error: "Invalid reassignTo stage ID" });
        return;
      }

      // Reassign tasks
      await db
        .update(tasksTable)
        .set({ status: String(reassignTo) })
        .where(and(eq(tasksTable.orgId, orgId), eq(tasksTable.status, String(stageId))));
    }

    await db
      .delete(workflowStagesTable)
      .where(and(eq(workflowStagesTable.id, stageId), eq(workflowStagesTable.orgId, orgId)));

    res.sendStatus(204);
  },
);

export default router;
