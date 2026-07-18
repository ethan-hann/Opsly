import { Badge } from "@/components/ui/badge";
import { badgeVariants, formatBadgeLabel, getPriorityBadgeVariant, getStatusBadgeVariant } from "@/lib/utils/badges";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: string;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant: getStatusBadgeVariant(status) }), className)} {...props}>
      {formatBadgeLabel(status)}
    </div>
  );
}

export interface PriorityBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  priority: string;
}

export function PriorityBadge({ priority, className, ...props }: PriorityBadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant: getPriorityBadgeVariant(priority) }), className)} {...props}>
      {formatBadgeLabel(priority)}
    </div>
  );
}
