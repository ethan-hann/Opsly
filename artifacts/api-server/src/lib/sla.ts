import type { SlaPolicy } from "@workspace/db";

export type SlaStatus = "on_track" | "warning" | "breached" | "none";

export interface SlaResult {
  /** Resolution SLA status. "none" when no policy is configured for this priority. */
  resolutionStatus: SlaStatus;
  /** Response SLA status. "none" when no policy is configured for this priority. */
  responseStatus: SlaStatus;
  /** Minutes remaining until resolution SLA is breached (negative if already breached). */
  resolutionMinutesRemaining: number | null;
  /** Minutes remaining until response SLA is breached (negative if already breached). */
  responseMinutesRemaining: number | null;
  /** Whether the resolution SLA is currently breached. */
  isResolutionBreached: boolean;
}

/**
 * Compute SLA status for a task given the org's policy for its priority.
 * Pure function — no DB access. Runs on every task read (no scheduled job needed).
 *
 * @param createdAt - Task creation timestamp
 * @param status    - Current task status string (legacy: "done" counts as resolved)
 * @param policy    - SLA policy for the task's priority (null if none configured)
 * @param stageType - Optional: explicit stage type ("open" | "closed"). When provided,
 *                    takes precedence over the legacy `status === "done"` check.
 */
export function getSlaStatus(
  createdAt: Date | string,
  status: string,
  policy: SlaPolicy | null | undefined,
  stageType?: "open" | "closed",
): SlaResult {
  if (!policy || (policy.responseMinutes == null && policy.resolutionMinutes == null)) {
    return {
      resolutionStatus: "none",
      responseStatus: "none",
      resolutionMinutesRemaining: null,
      responseMinutesRemaining: null,
      isResolutionBreached: false,
    };
  }

  // Resolve "done" from either the explicit stage type or the legacy status string
  const isDone = stageType === "closed" || (stageType == null && status === "done");
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const elapsedMinutes = (now - created) / 60_000;

  // Warning threshold: mirrors sla-detection logic — warningThresholdPercent % elapsed → warning.
  // Default 80 % elapsed (= 20 % remaining).
  const warningFraction = ((policy.warningThresholdPercent ?? 80)) / 100;

  // --- Response SLA ---
  let responseStatus: SlaStatus = "none";
  let responseMinutesRemaining: number | null = null;
  if (policy.responseMinutes != null) {
    const remaining = policy.responseMinutes - elapsedMinutes;
    responseMinutesRemaining = Math.round(remaining);
    if (isDone) {
      responseStatus = "on_track";
    } else if (remaining < 0) {
      responseStatus = "breached";
    } else if (remaining / policy.responseMinutes <= 1 - warningFraction) {
      responseStatus = "warning";
    } else {
      responseStatus = "on_track";
    }
  }

  // --- Resolution SLA ---
  let resolutionStatus: SlaStatus = "none";
  let resolutionMinutesRemaining: number | null = null;
  let isResolutionBreached = false;
  if (policy.resolutionMinutes != null) {
    const remaining = policy.resolutionMinutes - elapsedMinutes;
    resolutionMinutesRemaining = Math.round(remaining);
    if (isDone) {
      resolutionStatus = "on_track";
    } else if (remaining < 0) {
      resolutionStatus = "breached";
      isResolutionBreached = true;
    } else if (remaining / policy.resolutionMinutes <= 1 - warningFraction) {
      resolutionStatus = "warning";
    } else {
      resolutionStatus = "on_track";
    }
  }

  return {
    resolutionStatus,
    responseStatus,
    resolutionMinutesRemaining,
    responseMinutesRemaining,
    isResolutionBreached,
  };
}

/** Format a minute count into "Xh Ym" or "Ym" shorthand. */
export function formatSlaMinutes(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
