import { badgeVariants, formatBadgeLabel, getPriorityBadgeVariant, getStatusBadgeVariant } from "@/lib/utils/badges";
import * as React from "react";
import { cn } from "@/lib/utils";

// ─── StatusBadge ─────────────────────────────────────────────────────────────
// Renders a task's workflow stage. Prefers explicit stage fields (color, name)
// injected by the API; falls back to legacy enum-based display for any tasks
// that haven't been migrated yet.

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** task.status — the raw status value (stage ID string or legacy enum string) */
  status: string;
  /** task.stageName — human-readable stage name from the API */
  stageName?: string;
  /** task.stageColor — hex color from the stage definition */
  stageColor?: string;
  /** task.stageArchived — whether the stage is archived */
  stageArchived?: boolean;
}

export function StatusBadge({
  status,
  stageName,
  stageColor,
  stageArchived,
  className,
  ...props
}: StatusBadgeProps) {
  // If we have explicit stage details (from workflow stages API), use them
  if (stageName && stageColor) {
    const hex = stageColor.replace("#", "");
    // Compute a light background from the hex color (15% opacity approximation)
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
          stageArchived && "opacity-60",
          className,
        )}
        style={{
          backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`,
          borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
          color: stageColor,
        }}
        {...props}
      >
        {stageArchived && <span className="text-[10px] opacity-70">(archived)</span>}
        {stageName}
      </span>
    );
  }

  // Legacy fallback: use the old enum-based variant system
  return (
    <span className={cn(badgeVariants({ variant: getStatusBadgeVariant(status) }), className)} {...props}>
      {formatBadgeLabel(status)}
    </span>
  );
}

// ─── PriorityBadge ────────────────────────────────────────────────────────────

export interface PriorityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  priority: string;
}

export function PriorityBadge({ priority, className, ...props }: PriorityBadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant: getPriorityBadgeVariant(priority) }), className)} {...props}>
      {formatBadgeLabel(priority)}
    </span>
  );
}
