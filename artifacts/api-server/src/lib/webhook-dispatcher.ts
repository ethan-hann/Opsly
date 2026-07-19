/**
 * Outbound webhook dispatcher.
 *
 * After any task/project mutation, call the appropriate `dispatch*` helper.
 * Each call resolves matching enabled outbound webhooks for the org, signs the
 * payload with HMAC-SHA256, and POSTs asynchronously (fire-and-forget with one
 * automatic retry on network error).
 */

import crypto from "node:crypto";
import { db, outboundWebhooksTable } from "@workspace/db";
import type { OutboundWebhookEvent } from "@workspace/db";
import { eq, and, or, isNull } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function postWithRetry(url: string, body: string, sig: string): Promise<void> {
  const headers = {
    "Content-Type": "application/json",
    "X-Opsly-Signature": sig,
    "User-Agent": "Opsly-Webhook/1.0",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (!res.ok) {
        logger.warn({ url, status: res.status, attempt }, "Outbound webhook non-2xx response");
      }
      return; // success (even non-2xx counts as delivered)
    } catch (err) {
      if (attempt === 0) {
        logger.warn({ url, err }, "Outbound webhook delivery failed, retrying");
        await new Promise((r) => setTimeout(r, 500));
      } else {
        logger.error({ url, err }, "Outbound webhook delivery failed after retry");
      }
    }
  }
}

async function dispatch(
  orgId: string,
  event: OutboundWebhookEvent,
  projectId: number | null | undefined,
  payload: Record<string, unknown>,
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
          or(
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
      matching.map((h) => postWithRetry(h.url, body, sign(h.secret, body))),
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
): void {
  void dispatch(orgId, "note.updated", projectId, { note });
}

export function dispatchNoteDeleted(
  orgId: string,
  projectId: number | null | undefined,
  note: Record<string, unknown>,
): void {
  void dispatch(orgId, "note.deleted", projectId, { note });
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
