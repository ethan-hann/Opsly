/**
 * Default workflow stages seeded for every new organization, and as a
 * fallback for any existing org that has no stages configured yet.
 */

import { db, workflowStagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const DEFAULT_STAGES = [
  { name: "To Do",       color: "#6b7280", type: "open"   as const, position: 0 },
  { name: "In Progress", color: "#f59e0b", type: "open"   as const, position: 1 },
  { name: "Blocked",     color: "#ef4444", type: "open"   as const, position: 2 },
  { name: "Done",        color: "#10b981", type: "closed" as const, position: 3 },
];

/**
 * Insert the four default workflow stages for an org.
 * Returns the inserted rows so callers can use the IDs immediately.
 *
 * Safe to call speculatively: if stages already exist for the org, the
 * INSERT will simply succeed for the rows that aren't present yet.
 * Callers that want idempotent behavior should check first (GET /workflow-stages
 * does this to avoid redundant writes).
 */
export async function seedDefaultStages(
  orgId: string,
): Promise<(typeof workflowStagesTable.$inferSelect)[]> {
  return db
    .insert(workflowStagesTable)
    .values(DEFAULT_STAGES.map((s) => ({ ...s, orgId })))
    .returning();
}

/**
 * Return all workflow stages for an org, seeding defaults if none exist.
 * This is the canonical read path used by GET /workflow-stages.
 */
export async function getOrSeedStages(
  orgId: string,
): Promise<(typeof workflowStagesTable.$inferSelect)[]> {
  const existing = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.orgId, orgId));

  if (existing.length > 0) return existing;

  return seedDefaultStages(orgId);
}
