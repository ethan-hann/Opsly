/**
 * Unit tests for getSlaStatus and formatSlaMinutes.
 *
 * These are pure functions — no DB access, no mocks required.
 * The clock is pinned via vi.useFakeTimers so elapsed-minute
 * assertions are deterministic regardless of when the suite runs.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSlaStatus, formatSlaMinutes } from "./sla.js";

// Fixed reference point: 2025-06-01 12:00:00 UTC
const FIXED_NOW = new Date("2025-06-01T12:00:00.000Z").getTime();

/** Minimal SlaPolicy shape — only the fields getSlaStatus actually reads. */
function makePolicy(
  responseMinutes: number | null,
  resolutionMinutes: number | null,
): any {
  return { id: 1, orgId: "test-org", priority: "high", responseMinutes, resolutionMinutes };
}

/** Return a Date that was `minutes` minutes before FIXED_NOW. */
function minsAgo(minutes: number): Date {
  return new Date(FIXED_NOW - minutes * 60_000);
}

// ---------------------------------------------------------------------------
// getSlaStatus
// ---------------------------------------------------------------------------

describe("getSlaStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns all-none when policy is null", () => {
    const result = getSlaStatus(minsAgo(30), "todo", "high", null);
    expect(result).toEqual({
      resolutionStatus: "none",
      responseStatus: "none",
      resolutionMinutesRemaining: null,
      responseMinutesRemaining: null,
      isResolutionBreached: false,
    });
  });

  it("returns all-none when policy has both minutes set to null", () => {
    const result = getSlaStatus(minsAgo(30), "todo", "high", makePolicy(null, null));
    expect(result.resolutionStatus).toBe("none");
    expect(result.responseStatus).toBe("none");
    expect(result.isResolutionBreached).toBe(false);
  });

  it("returns on_track when well within both SLA limits", () => {
    // elapsed=60 out of response=120 (50%), resolution=480 (12.5%)
    const result = getSlaStatus(minsAgo(60), "todo", "high", makePolicy(120, 480));
    expect(result.responseStatus).toBe("on_track");
    expect(result.resolutionStatus).toBe("on_track");
    expect(result.isResolutionBreached).toBe(false);
    expect(result.responseMinutesRemaining).toBe(60);
    expect(result.resolutionMinutesRemaining).toBe(420);
  });

  it("returns warning when >80% of response SLA has elapsed (default threshold)", () => {
    // elapsed=70 out of response=80 → remaining=10 → 10/80 = 0.125 < 0.20 → warning
    const result = getSlaStatus(minsAgo(70), "todo", "high", makePolicy(80, 480));
    expect(result.responseStatus).toBe("warning");
    expect(result.resolutionStatus).toBe("on_track");
  });

  it("returns on_track when just below the 80% warning threshold", () => {
    // elapsed=60 out of response=80 → remaining=20 → 20/80 = 0.25 > 0.20 → on_track
    const result = getSlaStatus(minsAgo(60), "todo", "high", makePolicy(80, 480));
    expect(result.responseStatus).toBe("on_track");
  });

  it("returns warning when >80% of resolution SLA has elapsed (default threshold)", () => {
    // elapsed=400 out of resolution=480 → remaining=80 → 80/480 = 0.1667 < 0.20 → warning
    const result = getSlaStatus(minsAgo(400), "todo", "high", makePolicy(null, 480));
    expect(result.resolutionStatus).toBe("warning");
    expect(result.responseStatus).toBe("none");
  });

  it("respects a custom warningThresholdPercent on the policy", () => {
    // Policy with 75% threshold → warning when remaining/total ≤ 0.25
    // elapsed=60 out of response=80 → remaining=20 → 20/80 = 0.25 exactly → warning
    const policyWith75 = { ...makePolicy(80, null), warningThresholdPercent: 75 };
    const result = getSlaStatus(minsAgo(60), "todo", "high", policyWith75);
    expect(result.responseStatus).toBe("warning");
  });

  it("returns breached when past the response SLA deadline", () => {
    // elapsed=130 out of response=120 → remaining=-10
    const result = getSlaStatus(minsAgo(130), "todo", "high", makePolicy(120, 480));
    expect(result.responseStatus).toBe("breached");
    expect(result.resolutionStatus).toBe("on_track");
    expect(result.isResolutionBreached).toBe(false);
    expect(result.responseMinutesRemaining).toBe(-10);
  });

  it("returns resolution breached with isResolutionBreached=true when past resolution deadline", () => {
    // elapsed=490 out of resolution=480 → remaining=-10
    const result = getSlaStatus(minsAgo(490), "todo", "high", makePolicy(120, 480));
    expect(result.resolutionStatus).toBe("breached");
    expect(result.isResolutionBreached).toBe(true);
    expect(result.resolutionMinutesRemaining).toBe(-10);
  });

  it("returns on_track for a done task even when far past both SLA deadlines", () => {
    // Done tasks are never considered breached regardless of elapsed time
    const result = getSlaStatus(minsAgo(600), "done", "high", makePolicy(120, 480));
    expect(result.resolutionStatus).toBe("on_track");
    expect(result.responseStatus).toBe("on_track");
    expect(result.isResolutionBreached).toBe(false);
  });

  it("rounds remainingMinutes using Math.round", () => {
    // elapsed=60.4 min → resolutionRemaining = 480 - 60.4 = 419.6 → rounds to 420
    const createdAt = new Date(FIXED_NOW - 60.4 * 60_000);
    const result = getSlaStatus(createdAt, "todo", "high", makePolicy(null, 480));
    expect(result.resolutionMinutesRemaining).toBe(420);
  });

  it("accepts createdAt as an ISO string", () => {
    const result = getSlaStatus(minsAgo(60).toISOString(), "todo", "high", makePolicy(120, null));
    expect(result.responseStatus).toBe("on_track");
    expect(result.responseMinutesRemaining).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// formatSlaMinutes
// ---------------------------------------------------------------------------

describe("formatSlaMinutes", () => {
  it("formats zero minutes", () => {
    expect(formatSlaMinutes(0)).toBe("0m");
  });

  it("formats minutes under 60", () => {
    expect(formatSlaMinutes(45)).toBe("45m");
    expect(formatSlaMinutes(1)).toBe("1m");
    expect(formatSlaMinutes(59)).toBe("59m");
  });

  it("formats exactly 60 minutes as 1h (no trailing minutes)", () => {
    expect(formatSlaMinutes(60)).toBe("1h");
    expect(formatSlaMinutes(120)).toBe("2h");
  });

  it("formats hours with a remaining-minutes component", () => {
    expect(formatSlaMinutes(90)).toBe("1h 30m");
    expect(formatSlaMinutes(125)).toBe("2h 5m");
  });

  it("uses the absolute value for negative inputs", () => {
    expect(formatSlaMinutes(-45)).toBe("45m");
    expect(formatSlaMinutes(-90)).toBe("1h 30m");
  });
});
