/**
 * Resolves numeric custom field IDs to human-readable field names for outbound
 * webhook payloads. Fields are stored internally as `{ "1": value }` (keyed by
 * definition ID). This helper maps them to `{ "Genre": value }` so consumers
 * don't need to make a separate API call to interpret the payload.
 *
 * - Unknown IDs (deleted definitions) are dropped from the output.
 * - Soft-deleted definitions are excluded — their data is no longer meaningful.
 * - The API response format is not affected; only webhook payloads use this.
 */

import { db, customFieldDefinitionsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

export async function resolveCustomFieldNames(
  customFields: Record<string, unknown>,
  orgId: string,
): Promise<Record<string, unknown>> {
  const entries = Object.entries(customFields);
  if (entries.length === 0) return {};

  const definitions = await db
    .select({ id: customFieldDefinitionsTable.id, name: customFieldDefinitionsTable.name })
    .from(customFieldDefinitionsTable)
    .where(and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt)));

  const nameMap = new Map(definitions.map((d) => [String(d.id), d.name]));
  const resolved: Record<string, unknown> = {};

  for (const [fieldId, value] of entries) {
    const name = nameMap.get(fieldId);
    if (name !== undefined) {
      resolved[name] = value;
    }
  }

  return resolved;
}
