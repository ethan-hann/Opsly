import { useState, useEffect } from "react";
import { getSlaStatus, formatSlaMinutes } from "@/lib/sla";
import type { SlaResult } from "@/lib/sla";
import type { SlaPolicy } from "@workspace/api-client-react";

interface SlaBadgeProps {
  createdAt: string;
  status: string;
  priority: string;
  policies?: SlaPolicy[];
  className?: string;
}

/** Re-compute SLA status on a 30-second heartbeat so the countdown is live. */
function useSlaResult(
  createdAt: string,
  status: string,
  priority: string,
  policy: SlaPolicy | null | undefined,
): SlaResult {
  const [result, setResult] = useState<SlaResult>(() =>
    getSlaStatus(createdAt, status, priority, policy ?? null),
  );

  useEffect(() => {
    // Recompute immediately when props change
    setResult(getSlaStatus(createdAt, status, priority, policy ?? null));

    // Then tick every 30 s so the countdown stays fresh
    const id = setInterval(() => {
      setResult(getSlaStatus(createdAt, status, priority, policy ?? null));
    }, 30_000);

    return () => clearInterval(id);
  }, [createdAt, status, priority, policy]);

  return result;
}

export function SlaBadge({ createdAt, status, priority, policies, className }: SlaBadgeProps) {
  const policy = policies?.find((p) => p.priority === priority) ?? null;
  const result = useSlaResult(createdAt, status, priority, policy);

  if (result.resolutionStatus === "none" && result.responseStatus === "none") {
    return null;
  }

  // Resolution SLA takes precedence over response SLA for the dominant display
  const dominant = result.resolutionStatus !== "none" ? result.resolutionStatus : result.responseStatus;
  const minutes = result.resolutionMinutesRemaining ?? result.responseMinutesRemaining;

  const styles: Record<string, string> = {
    on_track: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    warning:  "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    breached: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    none:     "bg-muted text-muted-foreground border-border",
  };

  const labels: Record<string, string> = {
    on_track: minutes != null ? `SLA: ${formatSlaMinutes(minutes)} left` : "SLA: on track",
    warning:  minutes != null ? `SLA: ${formatSlaMinutes(minutes)} left` : "SLA: warning",
    breached: minutes != null ? `SLA: breached ${formatSlaMinutes(Math.abs(minutes))} ago` : "SLA: breached",
    none:     "No SLA",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${styles[dominant]} ${className ?? ""}`}
      title={`SLA status: ${dominant}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
        dominant === "on_track" ? "bg-emerald-500"
        : dominant === "warning" ? "bg-amber-500"
        : dominant === "breached" ? "bg-red-500 animate-pulse"
        : "bg-muted-foreground"
      }`} />
      {labels[dominant]}
    </span>
  );
}
