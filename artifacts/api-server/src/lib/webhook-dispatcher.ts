/**
 * Outbound webhook dispatcher.
 *
 * After any task/project mutation, call the appropriate `dispatch*` helper.
 * Each call resolves matching enabled outbound webhooks for the org, signs the
 * payload with HMAC-SHA256, and POSTs asynchronously (fire-and-forget with one
 * automatic retry on network error).
 */

import crypto from "node:crypto";
import { db, outboundWebhooksTable, outboundWebhookDeliveriesTable } from "@workspace/db";
import type { OutboundWebhookEvent } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postWithRetry(
  webhookId: number,
  event: string,
  url: string,
  body: string,
  sig: string,
): Promise<void> {
  const headers = {
    "Content-Type": "application/json",
    "X-Opsly-Signature": sig,
    "User-Agent": "Opsly-Webhook/1.0",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      const durationMs = Date.now() - start;
      const success = res.ok;
      if (!success) {
        logger.warn({ url, status: res.status, attempt }, "Outbound webhook non-2xx response");
      }
      // Record delivery (fire-and-forget — don't let a DB error affect the caller)
      db.insert(outboundWebhookDeliveriesTable)
        .values({ webhookId, event, url, statusCode: res.status, success, durationMs })
        .execute()
        .catch((e) => logger.error({ e }, "Failed to record webhook delivery"));
      return; // delivered (even non-2xx counts as a completed attempt)
    } catch (err) {
      const durationMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        logger.warn({ url, err }, "Outbound webhook delivery failed, retrying");
        await new Promise((r) => setTimeout(r, 500));
      } else {
        logger.error({ url, err }, "Outbound webhook delivery failed after retry");
        // Record the final failed attempt
        db.insert(outboundWebhookDeliveriesTable)
          .values({ webhookId, event, url, statusCode: null, success: false, durationMs, error: errMsg })
          .execute()
          .catch((e) => logger.error({ e }, "Failed to record webhook delivery"));
      }
    }
  }
}

async function dispatch(
  orgId: string,
  event: OutboundWebhookEvent,
  projectId: number | null | undefined,
  payload: Record<string, unknown>,
  /** When true, only project-specific webhooks are notified (org-wide webhooks
   *  are skipped). Use this when notifying about a note leaving an old project
   *  so that org-wide subscribers receive exactly one delivery for the action. */
  projectSpecificOnly = false,
): Promise<void> {
  try {
    // Match webhooks subscribed to this event, in this org, optionally filtered
    // by project. A webhook with no projectId fires for all org events; one with
    // a projectId only fires when the event's project matches.
    const hooks = await db
      .select()
      .from(outboundWebhooksTable)
      .where(
        and(
          eq(outboundWebhooksTable.orgId, orgId),
          eq(outboundWebhooksTable.enabled, true),
          projectSpecificOnly
            ? projectId != null
              ? eq(outboundWebhooksTable.projectId, projectId)
              : isNull(outboundWebhooksTable.projectId)
            : or(
                isNull(outboundWebhooksTable.projectId),
                projectId != null
                  ? eq(outboundWebhooksTable.projectId, projectId)
                  : isNull(outboundWebhooksTable.projectId),
              ),
        ),
      );

    const matching = hooks.filter(
      (h) => Array.isArray(h.events) && (h.events as OutboundWebhookEvent[]).includes(event),
    );

    if (matching.length === 0) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });

    await Promise.all(
      matching.map((h) => postWithRetry(h.id, event, h.url, body, sign(h.secret, body))),
    );
  } catch (err) {
    logger.error({ err, orgId, event }, "Outbound webhook dispatch error");
  }
}

// ---------------------------------------------------------------------------
// Public API — call these from route handlers after successful mutations
// ---------------------------------------------------------------------------

export function dispatchTaskCreated(
  orgId: string,
  projectId: number | null | undefined,
  task: Record<string, unknown>,
): void {
  void dispatch(orgId, "task.created", projectId, { task });
}

export function dispatchTaskUpdated(
  orgId: string,
  projectId: number | null | undefined,
  task: Record<string, unknown>,
  previousStatus?: string,
  previousAssignee?: string | null,
): void {
  const events: OutboundWebhookEvent[] = ["task.updated"];
  if (previousStatus !== undefined && previousStatus !== task["status"]) {
    events.push("task.status_changed");
  }
  if (previousAssignee !== undefined && previousAssignee !== task["assignee"]) {
    events.push("task.assigned");
  }

  const payload = { task, previousStatus, previousAssignee };
  for (const event of events) {
    void dispatch(orgId, event, projectId, payload);
  }
}

export function dispatchTaskCommented(
  orgId: string,
  projectId: number | null | undefined,
  task: Record<string, unknown>,
  comment: Record<string, unknown>,
): void {
  void dispatch(orgId, "task.commented", projectId, { task, comment });
}

export function dispatchNoteCreated(
  orgId: string,
  projectId: number | null | undefined,
  note: Record<string, unknown>,
): void {
  void dispatch(orgId, "note.created", projectId, { note });
}

export function dispatchNoteUpdated(
  orgId: string,
  projectId: number | null | undefined,
  note: Record<string, unknown>,
  projectSpecificOnly = false,
): void {
  void dispatch(orgId, "note.updated", projectId, { note }, projectSpecificOnly);
}

export function dispatchNoteDeleted(
  orgId: string,
  projectId: number | null | undefined,
  note: Record<string, unknown>,
): void {
  void dispatch(orgId, "note.deleted", projectId, { note });
}

export function dispatchTaskSlaBreached(
  orgId: string,
  projectId: number | null | undefined,
  task: Record<string, unknown>,
  minutesOverdue: number,
): void {
  void dispatch(orgId, "task.sla_breached", projectId, { task, minutesOverdue });
}

export function dispatchProjectCreated(
  orgId: string,
  project: Record<string, unknown>,
): void {
  void dispatch(orgId, "project.created", project["id"] as number, { project });
}

export function dispatchProjectUpdated(
  orgId: string,
  project: Record<string, unknown>,
): void {
  void dispatch(orgId, "project.updated", project["id"] as number, { project });
}
