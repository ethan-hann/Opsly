import { Router, type IRouter } from "express";
import { eq, sql, and, ne, inArray } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskDependenciesTable,
  workflowStagesTable,
  projectsTable,
} from "@workspace/db";
import {
  requireOrgOrApiKey,
  requirePermission,
  requireScope,
  hasPermission,
} from "../middlewares/requireOrgMiddleware";
import { requireOrgFeature } from "../lib/org-features";
import { z } from "zod/v4";

const router: IRouter = Router();

const requireTaskTrees = requireOrgFeature("task_trees");

// ─── Input schemas ────────────────────────────────────────────────────────────

const GetDepsQuery = z.object({
  projectId: z.coerce.number().int().positive(),
});

const CreateDepBody = z.object({
  taskId: z.number().int().positive(),
  dependsOnTaskId: z.number().int().positive(),
});

const DeleteDepParams = z.object({
  id: z.coerce.number().int().positive(),
});

const MoveDepBody = z.object({
  newDependsOnTaskId: z.number().int().positive(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check for a cycle that would be created by adding edge (taskId → dependsOnTaskId).
 * Returns the cycle path as an array of task IDs if a cycle would form, or null.
 *
 * A cycle exists if dependsOnTaskId can already reach taskId via existing edges
 * (i.e. there is a path dependsOnTaskId →...→ taskId in the dependency graph).
 */
async function detectCycle(
  taskId: number,
  dependsOnTaskId: number,
  orgId: string,
  excludeEdgeId?: number,
): Promise<number[] | null> {
  const excludeId = excludeEdgeId ?? -1;
  // Use a recursive CTE to find all tasks reachable from dependsOnTaskId.
  // If taskId is reachable, adding the edge taskId→dependsOnTaskId would form a cycle.
  const result = await db.execute(sql`
    WITH RECURSIVE reachable(task_id, path) AS (
      -- Base: start from dependsOnTaskId following existing edges upward (depends_on_task_id → task_id)
      -- We traverse: given node X, what nodes does X depend on?
      SELECT d.depends_on_task_id, ARRAY[d.task_id, d.depends_on_task_id]
      FROM task_dependencies d
      WHERE d.task_id = ${dependsOnTaskId} AND d.org_id = ${orgId} AND d.id <> ${excludeId}
      UNION ALL
      SELECT d.depends_on_task_id, r.path || d.depends_on_task_id
      FROM task_dependencies d
      JOIN reachable r ON d.task_id = r.task_id
      WHERE NOT d.depends_on_task_id = ANY(r.path)
        AND d.org_id = ${orgId}
        AND d.id <> ${excludeId}
    )
    SELECT path FROM reachable WHERE task_id = ${taskId}
    LIMIT 1
  `);

  const rows = result.rows as Array<{ path: number[] }>;
  if (rows.length > 0) {
    return [taskId, ...rows[0].path];
  }
  return null;
}

// ─── GET /task-dependencies ───────────────────────────────────────────────────

router.get(
  "/task-dependencies",
  requireOrgOrApiKey,
  requireScope("tasks:read"),
  requireTaskTrees,
  async (req, res): Promise<void> => {
    if (!hasPermission(req, "view_tasks")) {
      res.status(403).json({ error: "Permission required: view_tasks" });
      return;
    }

    const parsed = GetDepsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "projectId (integer) is required" });
      return;
    }

    const orgId = req.orgId!;
    const { projectId } = parsed.data;

    // Confirm the project belongs to this org
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) {
      res.status(400).json({ error: "Project not found in this organization" });
      return;
    }

    // Return all dependency edges where taskId belongs to the project
    const edges = await db
      .select({
        id: taskDependenciesTable.id,
        taskId: taskDependenciesTable.taskId,
        dependsOnTaskId: taskDependenciesTable.dependsOnTaskId,
      })
      .from(taskDependenciesTable)
      .innerJoin(
        tasksTable,
        and(
          eq(taskDependenciesTable.taskId, tasksTable.id),
          eq(tasksTable.projectId, projectId),
          eq(tasksTable.orgId, orgId),
        ),
      )
      .where(eq(taskDependenciesTable.orgId, orgId));

    res.json(edges);
  },
);

// ─── POST /task-dependencies ──────────────────────────────────────────────────

router.post(
  "/task-dependencies",
  requireOrgOrApiKey,
  requireTaskTrees,
  requirePermission("link_tasks"),
  async (req, res): Promise<void> => {
    const parsed = CreateDepBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "taskId and dependsOnTaskId (integers) are required" });
      return;
    }

    const orgId = req.orgId!;
    const { taskId, dependsOnTaskId } = parsed.data;

    if (taskId === dependsOnTaskId) {
      res.status(400).json({ error: "A task cannot depend on itself" });
      return;
    }

    // Fetch both tasks (must belong to this org)
    const [taskRow, parentRow] = await Promise.all([
      db
        .select({ id: tasksTable.id, projectId: tasksTable.projectId })
        .from(tasksTable)
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, orgId)))
        .limit(1)
        .then((r) => r[0]),
      db
        .select({ id: tasksTable.id, projectId: tasksTable.projectId })
        .from(tasksTable)
        .where(and(eq(tasksTable.id, dependsOnTaskId), eq(tasksTable.orgId, orgId)))
        .limit(1)
        .then((r) => r[0]),
    ]);

    if (!taskRow) {
      res.status(400).json({ error: "Task not found in this organization" });
      return;
    }
    if (!parentRow) {
      res.status(400).json({ error: "Parent task not found in this organization" });
      return;
    }

    // Both tasks must belong to the same non-null project
    if (taskRow.projectId == null || parentRow.projectId == null) {
      res.status(400).json({ error: "Both tasks must belong to a project to link them" });
      return;
    }
    if (taskRow.projectId !== parentRow.projectId) {
      res.status(400).json({ error: "Cross-project dependency linking is not supported" });
      return;
    }

    // Cycle detection
    const cyclePath = await detectCycle(taskId, dependsOnTaskId, orgId);
    if (cyclePath) {
      // Convert internal task IDs to org task numbers for a human-readable message
      const cycleTaskRows = await db
        .select({ id: tasksTable.id, orgTaskNumber: tasksTable.orgTaskNumber })
        .from(tasksTable)
        .where(and(inArray(tasksTable.id, cyclePath), eq(tasksTable.orgId, orgId)));
      const numMap = new Map(cycleTaskRows.map((r) => [r.id, r.orgTaskNumber]));
      const cycleStr = cyclePath.map((id) => `TSK-${numMap.get(id) ?? id}`).join(" → ");
      res.status(409).json({
        error: `Dependency would create a cycle: ${cycleStr}`,
      });
      return;
    }

    // Insert the edge
    const [edge] = await db
      .insert(taskDependenciesTable)
      .values({ orgId, taskId, dependsOnTaskId })
      .onConflictDoNothing()
      .returning();

    if (!edge) {
      // Already exists — fetch it
      const [existing] = await db
        .select()
        .from(taskDependenciesTable)
        .where(
          and(
            eq(taskDependenciesTable.taskId, taskId),
            eq(taskDependenciesTable.dependsOnTaskId, dependsOnTaskId),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(500).json({ error: "Failed to create dependency" });
        return;
      }
      // Return existing edge with parent task info
      const parentWithStage = await getTaskTreeItem(dependsOnTaskId, orgId);
      res.status(201).json({
        id: existing.id,
        taskId: existing.taskId,
        dependsOnTaskId: existing.dependsOnTaskId,
        ...parentWithStage,
      });
      return;
    }

    // Enrich with parent task info
    const parentWithStage = await getTaskTreeItem(dependsOnTaskId, orgId);
    res.status(201).json({
      id: edge.id,
      taskId: edge.taskId,
      dependsOnTaskId: edge.dependsOnTaskId,
      ...parentWithStage,
    });
  },
);

// ─── PATCH /task-dependencies/:id — move an edge to a new parent ─────────────

router.patch(
  "/task-dependencies/:id",
  requireOrgOrApiKey,
  requireTaskTrees,
  requirePermission("link_tasks"),
  async (req, res): Promise<void> => {
    const parsedParams = DeleteDepParams.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: "Invalid dependency ID" });
      return;
    }
    const parsedBody = MoveDepBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "newDependsOnTaskId (integer) is required" });
      return;
    }

    const orgId = req.orgId!;
    const { id } = parsedParams.data;
    const { newDependsOnTaskId } = parsedBody.data;

    // Fetch the existing edge
    const [edge] = await db
      .select({
        id: taskDependenciesTable.id,
        taskId: taskDependenciesTable.taskId,
        dependsOnTaskId: taskDependenciesTable.dependsOnTaskId,
      })
      .from(taskDependenciesTable)
      .where(
        and(
          eq(taskDependenciesTable.id, id),
          eq(taskDependenciesTable.orgId, orgId),
        ),
      )
      .limit(1);

    if (!edge) {
      res.status(404).json({ error: "Dependency not found" });
      return;
    }

    if (newDependsOnTaskId === edge.taskId) {
      res.status(400).json({ error: "A task cannot depend on itself" });
      return;
    }

    // No-op move
    if (newDependsOnTaskId === edge.dependsOnTaskId) {
      res.json(edge);
      return;
    }

    // The new parent must exist in this org and share the child's project
    const [childRow, newParentRow] = await Promise.all([
      db
        .select({ id: tasksTable.id, projectId: tasksTable.projectId })
        .from(tasksTable)
        .where(and(eq(tasksTable.id, edge.taskId), eq(tasksTable.orgId, orgId)))
        .limit(1)
        .then((r) => r[0]),
      db
        .select({ id: tasksTable.id, projectId: tasksTable.projectId })
        .from(tasksTable)
        .where(and(eq(tasksTable.id, newDependsOnTaskId), eq(tasksTable.orgId, orgId)))
        .limit(1)
        .then((r) => r[0]),
    ]);

    if (!childRow) {
      res.status(400).json({ error: "Task not found in this organization" });
      return;
    }
    if (!newParentRow) {
      res.status(400).json({ error: "Parent task not found in this organization" });
      return;
    }
    if (childRow.projectId == null || newParentRow.projectId == null) {
      res.status(400).json({ error: "Both tasks must belong to a project to link them" });
      return;
    }
    if (childRow.projectId !== newParentRow.projectId) {
      res.status(400).json({ error: "Cross-project dependency linking is not supported" });
      return;
    }

    // Cycle detection — pretend the old edge is already gone
    const cyclePath = await detectCycle(edge.taskId, newDependsOnTaskId, orgId, edge.id);
    if (cyclePath) {
      const cycleTaskRows = await db
        .select({ id: tasksTable.id, orgTaskNumber: tasksTable.orgTaskNumber })
        .from(tasksTable)
        .where(and(inArray(tasksTable.id, cyclePath), eq(tasksTable.orgId, orgId)));
      const numMap = new Map(cycleTaskRows.map((r) => [r.id, r.orgTaskNumber]));
      const cycleStr = cyclePath.map((tid) => `TSK-${numMap.get(tid) ?? tid}`).join(" → ");
      res.status(409).json({
        error: `Move would create a cycle: ${cycleStr}`,
      });
      return;
    }

    // Atomically delete the old edge and insert the new one
    const moved = await db.transaction(async (tx) => {
      await tx
        .delete(taskDependenciesTable)
        .where(
          and(
            eq(taskDependenciesTable.id, edge.id),
            eq(taskDependenciesTable.orgId, orgId),
          ),
        );
      const [inserted] = await tx
        .insert(taskDependenciesTable)
        .values({ orgId, taskId: edge.taskId, dependsOnTaskId: newDependsOnTaskId })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
      // Edge to the new parent already existed — return it
      const [existing] = await tx
        .select()
        .from(taskDependenciesTable)
        .where(
          and(
            eq(taskDependenciesTable.taskId, edge.taskId),
            eq(taskDependenciesTable.dependsOnTaskId, newDependsOnTaskId),
            eq(taskDependenciesTable.orgId, orgId),
          ),
        )
        .limit(1);
      return existing ?? null;
    });

    if (!moved) {
      res.status(500).json({ error: "Failed to move dependency" });
      return;
    }

    res.json({
      id: moved.id,
      taskId: moved.taskId,
      dependsOnTaskId: moved.dependsOnTaskId,
    });
  },
);

// ─── DELETE /task-dependencies/:id ───────────────────────────────────────────

router.delete(
  "/task-dependencies/:id",
  requireOrgOrApiKey,
  requireTaskTrees,
  requirePermission("link_tasks"),
  async (req, res): Promise<void> => {
    const parsed = DeleteDepParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid dependency ID" });
      return;
    }

    const orgId = req.orgId!;
    const { id } = parsed.data;

    const deleted = await db
      .delete(taskDependenciesTable)
      .where(
        and(
          eq(taskDependenciesTable.id, id),
          eq(taskDependenciesTable.orgId, orgId),
        ),
      )
      .returning({ id: taskDependenciesTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Dependency not found" });
      return;
    }

    res.sendStatus(204);
  },
);

// ─── Helper: fetch a TaskTreeItem for a given task ───────────────────────────

async function getTaskTreeItem(taskId: number, orgId: string) {
  const [row] = await db
    .select({
      orgTaskNumber: tasksTable.orgTaskNumber,
      title: tasksTable.title,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!row) return { orgTaskNumber: 0, title: "", stageName: "", isClosed: false };

  // Resolve stage
  const stageId = parseInt(row.status, 10);
  let stageName = row.status;
  let isClosed = false;
  if (!isNaN(stageId)) {
    const [stage] = await db
      .select({ name: workflowStagesTable.name, type: workflowStagesTable.type })
      .from(workflowStagesTable)
      .where(and(eq(workflowStagesTable.id, stageId), eq(workflowStagesTable.orgId, orgId)))
      .limit(1);
    if (stage) {
      stageName = stage.name;
      isClosed = stage.type === "closed";
    }
  }

  return {
    orgTaskNumber: row.orgTaskNumber,
    title: row.title,
    stageName,
    isClosed,
  };
}

export default router;
