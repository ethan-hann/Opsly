/**
 * GET /org/audit-log
 *
 * Unified, reverse-chronological audit feed that merges org-level events
 * (org_events) and task-level events (task_events + tasks) for the current org.
 *
 * Permission: view_audit_log
 *
 * Query params:
 *   cursor  – opaque base64 cursor from a previous response
 *   limit   – max results (default 50, max 200)
 *   from    – ISO date lower bound (inclusive)
 *   to      – ISO date upper bound (inclusive)
 *   actor   – case-insensitive substring match on actorName
 *   category – one of the enum values (or "task" to show only task events)
 */

import { Router } from "express";
import { eq, and, gte, lte, ilike, lt, or, desc } from "drizzle-orm";
import { db, orgEventsTable, taskEventsTable, tasksTable } from "@workspace/db";
import { requireOrg, hasPermission } from "../middlewares/requireOrgMiddleware";
import { z } from "zod";

const router = Router();

const VALID_CATEGORIES = [
  "member",
  "project",
  "webhook",
  "role",
  "settings",
  "custom_field",
  "workflow",
  "task",
] as const;

type AuditCategory = (typeof VALID_CATEGORIES)[number];

/** Normalised event shape returned to the client. */
interface AuditEvent {
  id: string;           // "<source>:<numericId>"
  source: "org" | "task";
  category: AuditCategory;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetId: string | null;
  targetName: string | null;
  description: string;
  createdAt: string;    // ISO 8601
}

// ── Cursor encoding/decoding ────────────────────────────────────────────────
//
// A cursor encodes the globally monotonic page boundary.  Because we merge two
// independent tables we use a SINGLE createdAt timestamp as the primary cutoff
// and track the lowest numeric id from each source AT that exact timestamp so
// that rows with the same timestamp are never duplicated or skipped.
//
// Format (base64-encoded JSON):
//   { ts: string, orgId: number, taskId: number }
//   orgId  = smallest org-event id seen AT ts (0 = no org events at ts)
//   taskId = smallest task-event id seen AT ts (0 = no task events at ts)
//
// Subsequent page filter (per source):
//   createdAt < ts
//   OR (createdAt = ts AND id < orgId)   ← only when orgId > 0

interface PageCursor {
  ts: string;
  orgId: number;
  taskId: number;
}

function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): PageCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      typeof obj === "object" &&
      obj !== null &&
      "ts" in obj &&
      "orgId" in obj &&
      "taskId" in obj
    ) {
      return obj as PageCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build the next-page cursor from a fully-merged, already-sliced events array. */
function buildNextCursor(events: AuditEvent[]): string | null {
  if (events.length === 0) return null;
  const lastTs = events[events.length - 1].createdAt;

  let orgId = 0;
  let taskId = 0;
  for (const e of events) {
    if (e.createdAt !== lastTs) continue;
    const numId = parseInt(e.id.split(":")[1] ?? "0", 10);
    if (e.source === "org") {
      orgId = orgId === 0 ? numId : Math.min(orgId, numId);
    } else {
      taskId = taskId === 0 ? numId : Math.min(taskId, numId);
    }
  }

  return encodeCursor({ ts: lastTs, orgId, taskId });
}

// ── Description helpers ─────────────────────────────────────────────────────

function describeOrgEvent(
  action: string,
  actorName: string | null,
  targetName: string | null,
  metadata: Record<string, unknown> | null,
): string {
  const who = actorName || "Someone";
  const target = targetName || "";

  switch (action) {
    case "settings.org_renamed":
      return `${who} renamed the organization from "${metadata?.from ?? "?"}" to "${metadata?.to ?? target}"`;
    case "settings.sla_policies_updated":
      return `${who} updated org SLA policies`;
    case "member.invited":
      return `${who} invited ${target || "a user"}`;
    case "member.invite_cancelled":
      return `${who} cancelled an invitation`;
    case "member.joined":
      return `${target || who} joined the organization`;
    case "member.left":
      return `${target || who} left the organization`;
    case "member.removed":
      return `${who} removed ${target || "a member"}`;
    case "member.role_changed":
      return `${who} changed ${target}'s role from ${metadata?.from ?? "?"} to ${metadata?.to ?? "?"}`;
    case "project.created":
      return `${who} created project "${target}"`;
    case "project.updated":
      return `${who} updated project "${target}"`;
    case "project.deleted":
      return `${who} deleted project "${target}"`;
    case "project.sla_policies_updated":
      return `${who} updated SLA policies for project #${metadata?.projectId ?? target}`;
    case "webhook.inbound_created":
      return `${who} created inbound webhook "${target}"`;
    case "webhook.inbound_updated":
      return `${who} updated inbound webhook "${target}"`;
    case "webhook.inbound_deleted":
      return `${who} deleted inbound webhook "${target}"`;
    case "webhook.inbound_secret_rotated":
      return `${who} rotated the secret for inbound webhook "${target}"`;
    case "webhook.outbound_created":
      return `${who} created outbound webhook "${target}"`;
    case "webhook.outbound_updated":
      return `${who} updated outbound webhook "${target}"`;
    case "webhook.outbound_deleted":
      return `${who} deleted outbound webhook "${target}"`;
    case "role.created":
      return `${who} created role "${target}"`;
    case "role.updated":
      return `${who} updated role "${target}"`;
    case "role.deleted":
      return `${who} deleted role "${target}"`;
    case "custom_field.created":
      return `${who} created custom field "${target}"`;
    case "custom_field.updated":
      return `${who} updated custom field "${target}"`;
    case "custom_field.deleted":
      return `${who} deleted custom field "${target}"`;
    case "custom_field.purged":
      return `${who} permanently purged custom field #${target}`;
    case "workflow.stage_created":
      return `${who} created workflow stage "${target}"`;
    case "workflow.stage_updated":
      return `${who} updated workflow stage "${target}"`;
    case "workflow.stage_deleted":
      return `${who} deleted workflow stage "${target}"`;
    case "workflow.stages_reordered":
      return `${who} reordered workflow stages`;
    default:
      return `${who} performed action: ${action}`;
  }
}

function describeTaskEvent(
  field: string,
  oldValue: string | null,
  newValue: string | null,
  taskTitle: string | null,
): string {
  const task = taskTitle ? `"${taskTitle}"` : "a task";
  if (field === "created") return `Created task ${task}`;
  if (field.startsWith("cf:")) {
    const cfName = field.slice(3);
    if (!oldValue && newValue) return `Set ${cfName} on ${task} to ${newValue}`;
    if (oldValue && !newValue) return `Cleared ${cfName} on ${task}`;
    return `Changed ${cfName} on ${task}`;
  }
  const fieldLabel: Record<string, string> = {
    status: "Status", priority: "Priority", assignee: "Assignee",
    category: "Category", title: "Title", dueDate: "Due date",
    projectId: "Project", sla_breached: "SLA breached", sla_warning: "SLA warning",
  };
  const label = fieldLabel[field] ?? field;
  if (!oldValue && newValue) return `Set ${label} on ${task} to ${newValue}`;
  if (oldValue && !newValue) return `Cleared ${label} on ${task}`;
  return `Changed ${label} on ${task}`;
}

// ── Query schema ─────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  from: z.string().optional(),
  to: z.string().optional(),
  actor: z.string().optional(),
  category: z.enum(VALID_CATEGORIES).optional(),
});

// ── Route ─────────────────────────────────────────────────────────────────────

router.get(
  "/org/audit-log",
  requireOrg,
  async (req, res): Promise<void> => {
    if (!hasPermission(req, "view_audit_log")) {
      res.status(403).json({ error: "Permission required: view_audit_log" });
      return;
    }

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { cursor: rawCursor, limit, from, to, actor, category } = parsed.data;
    const orgId = req.orgId!;

    // Parse cursor — produces a globally monotonic page boundary.
    const cur: PageCursor | null = rawCursor ? decodeCursor(rawCursor) : null;
    const cursorTs = cur ? new Date(cur.ts) : null;

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to + "T23:59:59.999Z") : null;

    // Build the common keyset predicate for a given source-specific id.
    // Returns conditions to append to WHERE: (createdAt < cursorTs) OR
    // (createdAt = cursorTs AND id < sourceId).  When sourceId = 0 (no events
    // at cursorTs for this source) we only keep the strict createdAt < guard.
    function keysetWhere(
      createdAtCol: typeof orgEventsTable.createdAt | typeof taskEventsTable.createdAt,
      idCol: typeof orgEventsTable.id | typeof taskEventsTable.id,
      sourceId: number,
    ) {
      if (!cursorTs) return null;
      if (sourceId > 0) {
        // This source had events at cursorTs in the returned page.  Exclude all
        // rows at cursorTs with id >= sourceId (already seen), keep everything before.
        return or(
          lt(createdAtCol, cursorTs) as any,
          and(
            eq(createdAtCol as any, cursorTs) as any,
            lt(idCol, sourceId) as any,
          ) as any,
        );
      }
      // sourceId = 0: this source had NO events at cursorTs in the returned page.
      // Use <= so that any events from this source at exactly cursorTs are still
      // included on the next page (they were not skipped — they just weren't in
      // the previous slice because events from the other source ranked higher).
      return lte(createdAtCol, cursorTs) as any;
    }

    // ── Org events ────────────────────────────────────────────────────────
    const orgIncluded = !category || category !== "task";
    let orgEvents: AuditEvent[] = [];

    if (orgIncluded) {
      const orgWhere: ReturnType<typeof eq>[] = [eq(orgEventsTable.orgId, orgId) as any];
      // Inside this block category !== "task" is already guaranteed by orgIncluded.
      if (category) orgWhere.push(eq(orgEventsTable.category, category as any) as any);
      if (fromDate) orgWhere.push(gte(orgEventsTable.createdAt, fromDate) as any);
      if (toDate) orgWhere.push(lte(orgEventsTable.createdAt, toDate) as any);
      if (actor) orgWhere.push(ilike(orgEventsTable.actorName, `%${actor}%`) as any);
      const ks = keysetWhere(orgEventsTable.createdAt, orgEventsTable.id, cur?.orgId ?? 0);
      if (ks) orgWhere.push(ks as any);

      const rows = await db
        .select()
        .from(orgEventsTable)
        .where(and(...orgWhere))
        .orderBy(desc(orgEventsTable.createdAt), desc(orgEventsTable.id))
        .limit(limit + 1);

      orgEvents = rows.map((r) => ({
        id: `org:${r.id}`,
        source: "org" as const,
        category: r.category as AuditCategory,
        action: r.action,
        actorId: r.actorId ?? null,
        actorName: r.actorName ?? null,
        targetId: r.targetId ?? null,
        targetName: r.targetName ?? null,
        description: describeOrgEvent(r.action, r.actorName, r.targetName, r.metadata as Record<string, unknown> | null),
        createdAt: r.createdAt.toISOString(),
      }));
    }

    // ── Task events ──────────────────────────────────────────────────────
    const taskIncluded = !category || category === "task";
    let taskEvents: AuditEvent[] = [];

    if (taskIncluded) {
      const taskWhere: ReturnType<typeof eq>[] = [eq(taskEventsTable.orgId, orgId) as any];
      if (fromDate) taskWhere.push(gte(taskEventsTable.createdAt, fromDate) as any);
      if (toDate) taskWhere.push(lte(taskEventsTable.createdAt, toDate) as any);
      if (actor) taskWhere.push(ilike(taskEventsTable.actorName, `%${actor}%`) as any);
      const ks = keysetWhere(taskEventsTable.createdAt, taskEventsTable.id, cur?.taskId ?? 0);
      if (ks) taskWhere.push(ks as any);

      const rows = await db
        .select({
          id: taskEventsTable.id,
          taskId: taskEventsTable.taskId,
          actorId: taskEventsTable.actorId,
          actorName: taskEventsTable.actorName,
          field: taskEventsTable.field,
          oldValue: taskEventsTable.oldValue,
          newValue: taskEventsTable.newValue,
          createdAt: taskEventsTable.createdAt,
          taskTitle: tasksTable.title,
        })
        .from(taskEventsTable)
        .leftJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
        .where(and(...taskWhere))
        .orderBy(desc(taskEventsTable.createdAt), desc(taskEventsTable.id))
        .limit(limit + 1);

      taskEvents = rows.map((r) => ({
        id: `task:${r.id}`,
        source: "task" as const,
        category: "task" as AuditCategory,
        action: `task.${r.field}`,
        actorId: r.actorId ?? null,
        actorName: r.actorName ?? null,
        targetId: String(r.taskId),
        targetName: r.taskTitle ?? null,
        description: describeTaskEvent(r.field, r.oldValue, r.newValue, r.taskTitle ?? null),
        createdAt: r.createdAt.toISOString(),
      }));
    }

    // ── Merge-sort ───────────────────────────────────────────────────────
    const merged = [...orgEvents, ...taskEvents].sort((a, b) => {
      const tDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (tDiff !== 0) return tDiff;
      // Tie-break: higher numeric id first (newer within same millisecond)
      const aId = parseInt(a.id.split(":")[1] ?? "0", 10);
      const bId = parseInt(b.id.split(":")[1] ?? "0", 10);
      return bId - aId;
    });

    const hasMore = merged.length > limit;
    const events = merged.slice(0, limit);
    const nextCursor = hasMore ? buildNextCursor(events) : null;

    res.json({ events, nextCursor });
  },
);

export default router;
