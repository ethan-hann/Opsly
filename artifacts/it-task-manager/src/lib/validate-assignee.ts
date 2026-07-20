/**
 * Validate the assignee value against the org member list.
 * Returns an error message if invalid, or empty string if valid.
 */
export function validateAssignee(
  value: string,
  memberEmails: Set<string>
): string {
  const trimmed = value.trim();
  if (!trimmed) return ""; // empty = unassigned, always valid
  if (!memberEmails.has(trimmed.toLowerCase())) {
    return "Assignee must be an org member's email address.";
  }
  return "";
}
