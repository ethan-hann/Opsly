import type { SlaPolicy } from "@workspace/api-client-react";

export type SlaStatus = "on_track" | "warning" | "breached" | "none";

export interface SlaResult {
  resolutionStatus: SlaStatus;
  responseStatus: SlaStatus;
  resolutionMinutesRemaining: number | null;
  responseMinutesRemaining: number | null;
  isResolutionBreached: boolean;
  /** Set only when the task is done: minutes elapsed from creation to resolution. */
  resolutionMinutesTaken: number | null;
}

/**
 * Pure SLA calculation — mirrors the server-side helper.
 * No network calls; safe to run on every render.
 *
 * @param resolvedAt  When the task was resolved (i.e. updatedAt for done tasks).
 *                    Used to compute "resolved in X" instead of "X left".
 */
export function getSlaStatus(
  createdAt: Date | string,
  status: string,
  priority: string,
  policy: SlaPolicy | null | undefined,
  stageType?: "open" | "closed",
  resolvedAt?: Date | string | null,
): SlaResult {
  if (!policy || (policy.responseMinutes == null && policy.resolutionMinutes == null)) {
    return {
      resolutionStatus: "none",
      responseStatus: "none",
      resolutionMinutesRemaining: null,
      responseMinutesRemaining: null,
      isResolutionBreached: false,
      resolutionMinutesTaken: null,
    };
  }

  // Use stageType when available (custom workflow); fall back to legacy status === "done"
  const isDone = stageType != null ? stageType === "closed" : status === "done";
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const elapsedMinutes = (now - created) / 60_000;

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
    } else if (remaining / policy.responseMinutes <= 0.25) {
      responseStatus = "warning";
    } else {
      responseStatus = "on_track";
    }
  }

  // --- Resolution SLA ---
  let resolutionStatus: SlaStatus = "none";
  let resolutionMinutesRemaining: number | null = null;
  let isResolutionBreached = false;
  let resolutionMinutesTaken: number | null = null;

  if (policy.resolutionMinutes != null) {
    if (isDone) {
      // Compute how long it actually took — use resolvedAt (updatedAt) if provided,
      // otherwise fall back to now (conservative approximation).
      const resolvedMs = resolvedAt ? new Date(resolvedAt).getTime() : now;
      const minutesTaken = (resolvedMs - created) / 60_000;
      resolutionMinutesTaken = Math.round(minutesTaken);
      isResolutionBreached = minutesTaken > policy.resolutionMinutes;
      resolutionStatus = isResolutionBreached ? "breached" : "on_track";
      resolutionMinutesRemaining = null; // not meaningful for resolved tasks
    } else {
      const remaining = policy.resolutionMinutes - elapsedMinutes;
      resolutionMinutesRemaining = Math.round(remaining);
      if (remaining < 0) {
        resolutionStatus = "breached";
        isResolutionBreached = true;
      } else if (remaining / policy.resolutionMinutes <= 0.25) {
        resolutionStatus = "warning";
      } else {
        resolutionStatus = "on_track";
      }
    }
  }

  return {
    resolutionStatus,
    responseStatus,
    resolutionMinutesRemaining,
    responseMinutesRemaining,
    isResolutionBreached,
    resolutionMinutesTaken,
  };
}

/** Format a minute count into "Xh Ym" or "Ym". */
export function formatSlaMinutes(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
