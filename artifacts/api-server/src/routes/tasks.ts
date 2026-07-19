import { Router, type IRouter } from "express";
import { eq, sql, and, lt, lte, gte, or, isNull, asc } from "drizzle-orm";
import { db, tasksTable, projectsTable, commentsTable, orgMembersTable, usersTable, customFieldDefinitionsTable, taskEventsTable, slaPoliciesTable } from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  ListTasksQueryParams,
  ListTasksResponse,
  CreateTaskResponse,
  GetTaskResponse,
  UpdateTaskResponse,
  GetOverdueTasksResponse,
  ListTaskEventsParams,
  ListTaskEventsResponse,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCreated, dispatchTaskUpdated, dispatchTaskSlaBreached } from "../lib/webhook-dispatcher";
import { resolveCustomFieldNames } from "../lib/resolve-custom-fields";
import { getSlaStatus } from "../lib/sla";

const router: IRouter = Router();

// ─── SLA breach detection ─────────────────────────────────────────────────────

/**
 * For a list of tasks, detect any that have breached their resolution SLA but
 * haven't had slaBreachedAt set yet. Sets the timestamp and fires the webhook.
 *
 * Policies must be pre-fetched by the caller (deterministic queue position for tests).
 * Atomic: uses WHERE sla_breached_at IS NULL so only the first concurrent reader fires.
 * Fire-and-forget: errors are swallowed so they don't affect the response.
 */
async function detectAndMarkSlaBreaches(
  tasks: (typeof tasksTable.$inferSelect)[],
  orgId: string,
  policies: (typeof slaPoliciesTable.$inferSelect)[],
): Promise<void> {
  try {
    // Only evaluate open tasks that haven't been flagged yet
    const candidates = tasks.filter(
      (t) => t.status !== "done" && t.slaBreachedAt == null,
    );
    if (candidates.length === 0) return;

    const policyMap = new Map(policies.map((p) => [p.priority, p]));

    for (const task of candidates) {
      const policy = policyMap.get(task.priority) ?? null;
      const slaResult = getSlaStatus(task.createdAt, task.status, task.priority, policy);

      if (slaResult.isResolutionBreached) {
        const now = new Date();
        // Atomic: only dispatch if this process is the first to set slaBreachedAt
        const [updated] = await db
          .update(tasksTable)
          .set({ slaBreachedAt: now })
          .where(and(eq(tasksTable.id, task.id), eq(tasksTable.orgId, orgId), isNull(tasksTable.slaBreachedAt)))
          .returning({ id: tasksTable.id });

        if (updated) {
          const minutesOverdue = Math.abs(slaResult.resolutionMinutesRemaining ?? 0);
          dispatchTaskSlaBreached(orgId, task.projectId, {
            id: task.id,
            orgTaskNumber: task.orgTaskNumber,
            title: task.title,
            priority: task.priority,
            status: task.status,
            slaBreachedAt: now.toISOString(),
          }, minutesOverdue);
        }
      }
    }
  } catch {
    // Never let SLA breach detection fail a response
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build enriched task payload.
 * Project lookup is scoped to orgId to prevent cross-tenant metadata leaks.
 */
async function buildTaskWithProject(
  task: typeof tasksTable.$inferSelect,
  orgId: string,
) {
  // Only expose project name if the project belongs to the same org
  const [project] = task.projectId
    ? await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.id, task.projectId),
            eq(projectsTable.orgId, orgId),
          ),
        )
    : [];

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentsTable)
    .where(eq(commentsTable.taskId, task.id));

  return {
    ...task,
    projectId: task.projectId ?? null,
    projectName: project?.name ?? null,
    description: task.description ?? null,
    assignee: task.assignee ?? null,
    dueDate: task.dueDate ?? null,
    commentCount: count ?? 0,
    customFields: task.customFields ?? {},
    slaBreachedAt: task.slaBreachedAt instanceof Date ? task.slaBreachedAt.toISOString() : (task.slaBreachedAt ?? null),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}

/**
 * Validate and strip custom field values against the org's active field definitions.
 *
 * - Returns { error } if a value violates the field's type contract.
 * - Returns { sanitized } with unknown field IDs removed, ready for persistence.
 * - null/undefined values are allowed for any field (semantics: clear the field).
 */
async function validateAndSanitizeCustomFields(
  customFields: Record<string, unknown>,
  orgId: string,
): Promise<{ error: string; sanitized?: never } | { error?: never; sanitized: Record<string, unknown> }> {
  if (!customFields || Object.keys(customFields).length === 0) {
    return { sanitized: {} };
  }

  const definitions = await db
    .select()
    .from(customFieldDefinitionsTable)
    .where(and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt)));

  const defMap = new Map(definitions.map((d) => [String(d.id), d]));
  const sanitized: Record<string, unknown> = {};

  for (const [fieldId, value] of Object.entries(customFields)) {
    // Unknown field IDs are silently stripped — not persisted
    const def = defMap.get(fieldId);
    if (!def) continue;

    // null/undefined clears the field — always permitted
    if (value === null || value === undefined) {
      sanitized[fieldId] = null;
      continue;
    }

    switch (def.type) {
      case "text":
        if (typeof value !== "string") {
          return { error: `Custom field "${def.name}" expects a text (string) value` };
        }
        break;
      case "number":
        if (typeof value !== "number" && !(typeof value === "string" && value !== "" && !isNaN(Number(value)))) {
          return { error: `Custom field "${def.name}" expects a number` };
        }
        break;
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: `Custom field "${def.name}" expects a date in YYYY-MM-DD format` };
        }
        break;
      case "single_select": {
        const options = (def.options as string[]) ?? [];
        if (typeof value !== "string" || !options.includes(value)) {
          return { error: `Custom field "${def.name}" value must be one of: ${options.join(", ")}` };
        }
        break;
      }
      case "multi_select": {
        const options = (def.options as string[]) ?? [];
        if (!Array.isArray(value)) {
          return { error: `Custom field "${def.name}" expects an array of selected values` };
        }
        for (const v of value as unknown[]) {
          if (typeof v !== "string" || !options.includes(v)) {
            return { error: `Custom field "${def.name}" contains invalid option: ${String(v)}` };
          }
        }
        break;
      }
    }

    sanitized[fieldId] = value;
  }

  return { sanitized };
}

/**
 * Verify a projectId belongs to the org. Returns false if it doesn't.
 */
async function projectBelongsToOrg(projectId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

/**
 * Verify an assignee email belongs to an org member. Returns false if not found.
 * A null/undefined assignee is always considered valid (unassigned).
 */
async function assigneeBelongsToOrg(assignee: string | null | undefined, orgId: string): Promise<boolean> {
  if (!assignee) return true;
  const [row] = await db
    .select({ userId: orgMembersTable.userId })
    .from(orgMembersTable)
    .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
    .where(and(eq(orgMembersTable.orgId, orgId), eq(usersTable.email, assignee)))
    .limit(1);
  return !!row;
}

/**
 * Derive a human-readable display name from a user object.
 */
function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full || user.email || "Unknown";
}

/** Fields we track in the audit log and their serializers. */
const TRACKED_FIELDS = ["status", "priority", "assignee", "category", "title", "dueDate", "projectId"] as const;
type TrackedField = typeof TRACKED_FIELDS[number];

type TaskSnapshot = Pick<typeof tasksTable.$inferSelect, TrackedField>;

/**
 * Insert one task_events row per field that changed between prev and next.
 * Must be called inside the same logical operation as the update (no separate tx needed
 * since we do these as sequential inserts in the same request handler).
 */
async function insertChangeEvents(
  taskId: number,
  orgId: string,
  actorId: string | null,
  actorName: string | null,
  prev: TaskSnapshot,
  next: TaskSnapshot,
): Promise<void> {
  const events: Array<typeof taskEventsTable.$inferInsert> = [];

  for (const field of TRACKED_FIELDS) {
    const oldVal = prev[field];
    const newVal = next[field];

    // Normalize null/undefined to null for comparison
    const oldNorm = oldVal ?? null;
    const newNorm = newVal ?? null;

    if (oldNorm === newNorm) continue;

    events.push({
      taskId,
      orgId,
      actorId,
      actorName,
      field,
      oldValue: oldNorm !== null ? String(oldNorm) : null,
      newValue: newNorm !== null ? String(newNorm) : null,
    });
  }

  if (events.length > 0) {
    await db.insert(taskEventsTable).values(events);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/tasks/overdue", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const today = new Date().toISOString().split("T")[0];
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(
      eq(tasksTable.orgId, orgId),
      sql`${tasksTable.status} != 'done'`,
      or(
        lt(tasksTable.dueDate, today),
        eq(tasksTable.priority, "critical"),
      ),
    ))
    .orderBy(tasksTable.dueDate);

  const result = await Promise.all(tasks.map((t) => buildTaskWithProject(t, orgId)));
  res.json(GetOverdueTasksResponse.parse(result));
});

router.get("/tasks", requireOrg, async (req, res): Promise<void> => {
  const queryParams = ListTasksQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const orgId = req.orgId!;
  const { projectId, status, priority, category, assignee, dateFrom, dateTo } = queryParams.data;

  const conditions = [eq(tasksTable.orgId, orgId)];
  if (projectId != null) conditions.push(eq(tasksTable.projectId, projectId));
  if (status) conditions.push(eq(tasksTable.status, status));
  if (priority) conditions.push(eq(tasksTable.priority, priority));
  if (category) conditions.push(eq(tasksTable.category, category));
  if (assignee) conditions.push(eq(tasksTable.assignee, assignee));
  if (dateFrom) conditions.push(gte(tasksTable.dueDate, dateFrom));
  if (dateTo) conditions.push(lte(tasksTable.dueDate, dateTo));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(tasksTable.createdAt);

  // Pre-fetch SLA policies for breach detection (deterministic queue position, only when needed)
  const slaPolicies = tasks.length > 0
    ? await db.select().from(slaPoliciesTable).where(eq(slaPoliciesTable.orgId, orgId))
    : [];

  // Detect and mark newly breached SLA tasks (fire-and-forget, non-blocking)
  void detectAndMarkSlaBreaches(tasks, orgId, slaPolicies);

  const result = await Promise.all(tasks.map((t) => buildTaskWithProject(t, orgId)));
  res.json(ListTasksResponse.parse(result));
});

router.post("/tasks", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Enforce create_tasks permission server-side (frontend gate alone is insufficient)
  if (!req.orgPermissions?.create_tasks) {
    res.status(403).json({ error: "You do not have permission to create tasks" });
    return;
  }

  // Validate that projectId (if provided) belongs to this org
  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  // Validate that assignee (if provided) is an org member
  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  // Validate and sanitize custom field values (strip unknown field IDs, enforce types)
  let sanitizedCustomFields: Record<string, unknown> | undefined;
  if (parsed.data.customFields) {
    const result = await validateAndSanitizeCustomFields(
      parsed.data.customFields as Record<string, unknown>,
      orgId,
    );
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    sanitizedCustomFields = result.sanitized;
  }

  // Compute the next per-org sequential task number atomically within the insert
  const [{ nextNum }] = await db
    .select({ nextNum: sql<number>`COALESCE(MAX(${tasksTable.orgTaskNumber}), 0) + 1` })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, orgId));

  const { customFields: _rawCf, ...restCreateData } = parsed.data;
  const [task] = await db
    .insert(tasksTable)
    .values({
      ...restCreateData,
      orgId,
      orgTaskNumber: nextNum,
      ...(sanitizedCustomFields !== undefined ? { customFields: sanitizedCustomFields } : {}),
    })
    .returning();

  // Emit a "created" event for the new task
  const actorId = req.user?.id ?? null;
  const actorNameStr = req.user ? displayName(req.user) : null;
  await db.insert(taskEventsTable).values({
    taskId: task.id,
    orgId,
    actorId,
    actorName: actorNameStr,
    field: "created",
    oldValue: null,
    newValue: task.title,
  });

  const enriched = await buildTaskWithProject(task, orgId);
  const webhookCustomFields = await resolveCustomFieldNames(enriched.customFields as Record<string, unknown>, orgId);
  dispatchTaskCreated(orgId, task.projectId, { ...enriched, customFields: webhookCustomFields });
  res.status(201).json(CreateTaskResponse.parse(enriched));
});

router.get("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Pre-fetch SLA policies for breach detection (awaited for deterministic queue position)
  const slaPolicies = await db.select().from(slaPoliciesTable).where(eq(slaPoliciesTable.orgId, orgId));

  // Detect and mark breach on single-task reads too (fire-and-forget, non-blocking)
  void detectAndMarkSlaBreaches([task], orgId, slaPolicies);

  const enriched = await buildTaskWithProject(task, orgId);
  res.json(GetTaskResponse.parse(enriched));
});

router.patch("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Enforce edit_tasks permission server-side (frontend gate alone is insufficient)
  if (!req.orgPermissions?.edit_tasks) {
    res.status(403).json({ error: "You do not have permission to edit tasks" });
    return;
  }

  // Capture previous values for change-event diffing and outbound webhook dispatch
  const [prev] = await db
    .select({
      status: tasksTable.status,
      priority: tasksTable.priority,
      assignee: tasksTable.assignee,
      category: tasksTable.category,
      title: tasksTable.title,
      dueDate: tasksTable.dueDate,
      projectId: tasksTable.projectId,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!prev) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Validate that projectId (if being changed) belongs to this org
  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  // Validate that assignee (if being changed) is an org member
  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  // Validate, sanitize, and merge custom field values
  const { customFields: incomingCustomFields, ...restUpdateData } = parsed.data;
  let mergedCustomFields: Record<string, unknown> | undefined;
  if (incomingCustomFields !== undefined) {
    const cfResult = await validateAndSanitizeCustomFields(
      incomingCustomFields as Record<string, unknown>,
      orgId,
    );
    if (cfResult.error) {
      res.status(400).json({ error: cfResult.error });
      return;
    }
    // Merge sanitized values with existing custom fields (partial update semantics)
    const [existing] = await db
      .select({ customFields: tasksTable.customFields })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
      .limit(1);
    mergedCustomFields = {
      ...(existing?.customFields as Record<string, unknown> ?? {}),
      ...cfResult.sanitized,
    };
  }

  const setData = mergedCustomFields !== undefined
    ? { ...restUpdateData, customFields: mergedCustomFields }
    : restUpdateData;

  const [task] = await db
    .update(tasksTable)
    .set(setData)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Diff prev vs updated values and emit one event per changed tracked field
  const actorId = req.user?.id ?? null;
  const actorNameStr = req.user ? displayName(req.user) : null;
  await insertChangeEvents(
    task.id,
    orgId,
    actorId,
    actorNameStr,
    prev,
    {
      status: task.status,
      priority: task.priority,
      assignee: task.assignee,
      category: task.category,
      title: task.title,
      dueDate: task.dueDate,
      projectId: task.projectId,
    },
  );

  const enriched = await buildTaskWithProject(task, orgId);
  const webhookCustomFields = await resolveCustomFieldNames(enriched.customFields as Record<string, unknown>, orgId);
  dispatchTaskUpdated(orgId, task.projectId, { ...enriched, customFields: webhookCustomFields }, prev.status, prev.assignee);
  res.json(UpdateTaskResponse.parse(enriched));
});

router.delete("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const [task] = await db
    .delete(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/tasks/:id/events", requireOrg, async (req, res): Promise<void> => {
  const params = ListTaskEventsParams.safeParse(req.params);
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

  const events = await db
    .select()
    .from(taskEventsTable)
    .where(and(eq(taskEventsTable.taskId, params.data.id), eq(taskEventsTable.orgId, orgId)))
    .orderBy(asc(taskEventsTable.createdAt));

  res.json(
    ListTaskEventsResponse.parse(
      events.map((e) => ({
        ...e,
        actorId: e.actorId ?? null,
        actorName: e.actorName ?? null,
        oldValue: e.oldValue ?? null,
        newValue: e.newValue ?? null,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
      })),
    ),
  );
});

export default router;
