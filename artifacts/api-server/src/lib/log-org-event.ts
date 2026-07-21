import { db, orgEventsTable } from "@workspace/db";
import type { InsertOrgEvent } from "@workspace/db";

type LogOrgEventPayload = Omit<InsertOrgEvent, "id" | "createdAt">;

/**
 * Write a single org-level audit log entry. Fire-and-forget safe — errors are
 * swallowed so a logging failure never aborts the primary mutation.
 */
export async function logOrgEvent(payload: LogOrgEventPayload): Promise<void> {
  try {
    await db.insert(orgEventsTable).values(payload);
  } catch (err) {
    // Logging must never break the primary request
    console.error("[logOrgEvent] failed to write org_events row:", err);
  }
}
