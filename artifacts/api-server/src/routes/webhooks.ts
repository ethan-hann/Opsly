/**
 * Webhook routes — inbound (ingest + CRUD) and outbound (CRUD).
 *
 * Public route:
 *   POST /webhooks/inbound/:token/ingest  — no session auth required; the token
 *        in the URL acts as a bearer credential (64-char random hex).  External
 *        systems (Datadog, PagerDuty, GitHub Actions, curl, …) POST any JSON
 *        object and we create a task from it.
 *
 * Authenticated routes (requireOrg):
 *   GET|POST        /webhooks/inbound
 *   GET|PATCH|DELETE /webhooks/inbound/:id
 *   POST            /webhooks/inbound/:id/rotate-secret
 *   GET|POST        /webhooks/outbound
 *   GET|PATCH|DELETE /webhooks/outbound/:id
 */

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, or, ne } from "drizzle-orm";
import {
  db,
  inboundWebhooksTable,
  outboundWebhooksTable,
  tasksTable,
  projectsTable,
} from "@workspace/db";
import type { WebhookTaskTemplate, OutboundWebhookEvent } from "@workspace/db";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCreated } from "../lib/webhook-dispatcher";
import { sql } from "drizzle-orm";

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}


/** Resolve a dot-notation path within an object. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Visibility filter: own webhooks + any non-private shared webhook. */
function inboundVisibilityFilter(userId: string) {
  return or(
    eq(inboundWebhooksTable.createdBy, userId),
    ne(inboundWebhooksTable.visibility, "private"),
  );
}

function outboundVisibilityFilter(userId: string) {
  return or(
    eq(outboundWebhooksTable.createdBy, userId),
    ne(outboundWebhooksTable.visibility, "private"),
  );
}

function serializeInbound(w: typeof inboundWebhooksTable.$inferSelect, userId: string) {
  return {
    ...w,
    isOwner: w.createdBy === userId,
    ingestUrl: buildIngestUrl(w.token),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function serializeOutbound(w: typeof outboundWebhooksTable.$inferSelect, userId: string) {
  return {
    ...w,
    isOwner: w.createdBy === userId,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function buildIngestUrl(token: string): string {
  // The base API path is /api — callers reconstruct the full URL from the token.
  // We return the path only; the frontend prepends the origin.
  return `/api/webhooks/inbound/${token}/ingest`;
}

/** Apply the webhook's task template to a raw ingest payload. */
function applyTemplate(
  payload: Record<string, unknown>,
  template: WebhookTaskTemplate,
  projectId: number | null,
): {
  title: string;
  description: string | undefined;
  priority: string;
  category: string;
  dueDate: string | undefined;
  projectId: number | null;
} {
  // Title resolution
  const titleFromField = template.titleField
    ? getPath(payload, template.titleField)
    : undefined;
  const title =
    String(titleFromField ?? payload["title"] ?? template.defaultTitle ?? "Untitled Alert").slice(0, 500);

  // Description resolution
  const descFromField = template.descriptionField
    ? getPath(payload, template.descriptionField)
    : undefined;
  const rawDesc = descFromField ?? payload["description"];
  const description = rawDesc ? String(rawDesc) : undefined;

  // Priority + category start from template defaults, then get overridden by
  // payload direct fields, then by fieldMapping.
  let priority: string = template.defaultPriority ?? "medium";
  let category: string = template.defaultCategory ?? "incident";

  // Direct payload fields override template defaults
  if (payload["priority"]) priority = String(payload["priority"]);
  if (payload["category"]) category = String(payload["category"]);

  // fieldMapping overrides everything (most specific)
  if (template.fieldMapping) {
    for (const [payloadPath, taskField] of Object.entries(template.fieldMapping)) {
      const val = getPath(payload, payloadPath);
      if (val === undefined) continue;
      if (taskField === "priority") priority = String(val);
      else if (taskField === "category") category = String(val);
      else if (taskField === "description" && !description) {
        // handled separately
      }
    }
  }

  // Validate enums — fall back to defaults on invalid values
  const validPriorities = ["low", "medium", "high", "critical"];
  const validCategories = ["incident", "change", "maintenance", "deployment", "support", "other"];
  if (!validPriorities.includes(priority)) priority = "medium";
  if (!validCategories.includes(category)) category = "incident";

  const dueDate =
    typeof payload["dueDate"] === "string" ? payload["dueDate"] : undefined;

  return { title, description, priority, category, dueDate, projectId };
}

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const ALL_EVENTS: OutboundWebhookEvent[] = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "project.created",
  "project.updated",
  "note.created",
  "note.updated",
  "note.deleted",
];

const WebhookVisibilityEnum = z.enum(["private", "public_read", "public_write"]);
const OutboundEventEnum = z.enum([
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "project.created",
  "project.updated",
  "note.created",
  "note.updated",
  "note.deleted",
]);

const WebhookTaskTemplateSchema = z
  .object({
    titleField: z.string().optional(),
    defaultTitle: z.string().optional(),
    descriptionField: z.string().optional(),
    defaultPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
    defaultCategory: z
      .enum(["incident", "change", "maintenance", "deployment", "support", "other"])
      .optional(),
    fieldMapping: z.record(z.string(), z.string()).optional(),
  })
  .optional()
  .default({});

const CreateInboundSchema = z.object({
  name: z.string().min(1).max(200),
  projectId: z.number().int().positive().optional().nullable(),
  visibility: WebhookVisibilityEnum.optional().default("private"),
  enabled: z.boolean().optional().default(true),
  taskTemplate: WebhookTaskTemplateSchema,
});

const UpdateInboundSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  projectId: z.number().int().positive().optional().nullable(),
  visibility: WebhookVisibilityEnum.optional(),
  enabled: z.boolean().optional(),
  taskTemplate: WebhookTaskTemplateSchema,
});

const CreateOutboundSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.url(),
  projectId: z.number().int().positive().optional().nullable(),
  events: z.array(OutboundEventEnum).min(1),
  visibility: WebhookVisibilityEnum.optional().default("private"),
  enabled: z.boolean().optional().default(true),
});

const UpdateOutboundSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.url().optional(),
  projectId: z.number().int().positive().optional().nullable(),
  events: z.array(OutboundEventEnum).min(1).optional(),
  visibility: WebhookVisibilityEnum.optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// PUBLIC: Ingest endpoint
// ---------------------------------------------------------------------------

router.post("/webhooks/inbound/:token/ingest", async (req, res): Promise<void> => {
  const { token } = req.params;

  // Look up webhook by token
  const [hook] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(eq(inboundWebhooksTable.token, token))
    .limit(1);

  if (!hook) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  if (!hook.enabled) {
    res.status(403).json({ error: "Webhook is disabled" });
    return;
  }

  // Payload must be an object
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Payload must be a JSON object" });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const template = (hook.taskTemplate ?? {}) as WebhookTaskTemplate;
  const taskFields = applyTemplate(payload, template, hook.projectId ?? null);

  // Validate project still belongs to org (guard against project deletion race)
  if (taskFields.projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.id, taskFields.projectId),
          eq(projectsTable.orgId, hook.orgId),
        ),
      )
      .limit(1);
    if (!proj) taskFields.projectId = null;
  }

  // Compute next org task number
  const [{ nextNum }] = await db
    .select({ nextNum: sql<number>`COALESCE(MAX(${tasksTable.orgTaskNumber}), 0) + 1` })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, hook.orgId));

  const [task] = await db
    .insert(tasksTable)
    .values({
      orgId: hook.orgId,
      projectId: taskFields.projectId,
      orgTaskNumber: nextNum,
      sourceWebhookId: hook.id,
      title: taskFields.title,
      description: taskFields.description,
      priority: taskFields.priority,
      category: taskFields.category,
      dueDate: taskFields.dueDate,
      status: "todo",
    })
    .returning();

  // Fire outbound webhooks async
  dispatchTaskCreated(hook.orgId, task.projectId, {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });

  res.status(201).json({
    taskId: task.id,
    orgTaskNumber: task.orgTaskNumber,
    title: task.title,
  });
});

// ---------------------------------------------------------------------------
// AUTHENTICATED: Inbound webhook CRUD
// ---------------------------------------------------------------------------

// GET /webhooks/inbound — list
router.get("/webhooks/inbound", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user!.id;

  const hooks = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.orgId, orgId), inboundVisibilityFilter(userId)))
    .orderBy(inboundWebhooksTable.createdAt);

  res.json(hooks.map((h) => serializeInbound(h, userId)));
});

// POST /webhooks/inbound — create
router.post("/webhooks/inbound", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;
  const { name, projectId, visibility, enabled, taskTemplate } = parsed.data;

  // Validate projectId belongs to org
  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  const [hook] = await db
    .insert(inboundWebhooksTable)
    .values({
      orgId,
      createdBy: userId,
      name,
      token: generateToken(),
      projectId: projectId ?? null,
      visibility,
      enabled,
      taskTemplate: taskTemplate ?? {},
    })
    .returning();

  res.status(201).json(serializeInbound(hook, userId));
});

// GET /webhooks/inbound/:id — get
router.get("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [hook] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(
      and(
        eq(inboundWebhooksTable.id, id),
        eq(inboundWebhooksTable.orgId, orgId),
        inboundVisibilityFilter(userId),
      ),
    )
    .limit(1);

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(serializeInbound(hook, userId));
});

// PATCH /webhooks/inbound/:id — update (creator only)
router.patch("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can update this webhook" });
    return;
  }

  const { projectId, ...rest } = parsed.data;

  // Validate projectId if changing
  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const updateData: Partial<typeof inboundWebhooksTable.$inferInsert> = { ...rest };
  if (projectId !== undefined) updateData.projectId = projectId;

  const [hook] = await db
    .update(inboundWebhooksTable)
    .set(updateData)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeInbound(hook, userId));
});

// DELETE /webhooks/inbound/:id — delete (creator only)
router.delete("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can delete this webhook" });
    return;
  }

  await db
    .delete(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)));

  res.sendStatus(204);
});

// POST /webhooks/inbound/:id/rotate-secret — rotate token (creator only)
router.post("/webhooks/inbound/:id/rotate-secret", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can rotate this secret" });
    return;
  }

  const [hook] = await db
    .update(inboundWebhooksTable)
    .set({ token: generateToken() })
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeInbound(hook, userId));
});

// ---------------------------------------------------------------------------
// AUTHENTICATED: Outbound webhook CRUD
// ---------------------------------------------------------------------------

// GET /webhooks/outbound — list
router.get("/webhooks/outbound", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user!.id;

  const hooks = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.orgId, orgId), outboundVisibilityFilter(userId)))
    .orderBy(outboundWebhooksTable.createdAt);

  res.json(hooks.map((h) => serializeOutbound(h, userId)));
});

// POST /webhooks/outbound — create
router.post("/webhooks/outbound", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateOutboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;
  const { name, url, projectId, events, visibility, enabled } = parsed.data;

  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const [hook] = await db
    .insert(outboundWebhooksTable)
    .values({
      orgId,
      createdBy: userId,
      name,
      url,
      secret: generateToken(),
      projectId: projectId ?? null,
      events,
      visibility,
      enabled,
    })
    .returning();

  res.status(201).json(serializeOutbound(hook, userId));
});

// GET /webhooks/outbound/:id — get
router.get("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [hook] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(
      and(
        eq(outboundWebhooksTable.id, id),
        eq(outboundWebhooksTable.orgId, orgId),
        outboundVisibilityFilter(userId),
      ),
    )
    .limit(1);

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(serializeOutbound(hook, userId));
});

// PATCH /webhooks/outbound/:id — update (creator only)
router.patch("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateOutboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can update this webhook" });
    return;
  }

  const { projectId, ...rest } = parsed.data;

  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const updateData: Partial<typeof outboundWebhooksTable.$inferInsert> = { ...rest };
  if (projectId !== undefined) updateData.projectId = projectId;

  const [hook] = await db
    .update(outboundWebhooksTable)
    .set(updateData)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeOutbound(hook, userId));
});

// DELETE /webhooks/outbound/:id — delete (creator only)
router.delete("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can delete this webhook" });
    return;
  }

  await db
    .delete(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)));

  res.sendStatus(204);
});

export default router;
