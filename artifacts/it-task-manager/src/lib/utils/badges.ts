import { cva, type VariantProps } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 font-mono uppercase tracking-wider",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success: "border-transparent bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20",
        warning: "border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
        info: "border-transparent bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export function getStatusBadgeVariant(status: string): VariantProps<typeof badgeVariants>["variant"] {
  switch (status.toLowerCase()) {
    case "done":
    case "completed":
      return "success";
    case "in_progress":
    case "active":
      return "info";
    case "blocked":
    case "on_hold":
      return "warning";
    case "todo":
    case "planning":
      return "secondary";
    default:
      return "outline";
  }
}

export function getPriorityBadgeVariant(priority: string): VariantProps<typeof badgeVariants>["variant"] {
  switch (priority.toLowerCase()) {
    case "critical":
      return "destructive";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
      return "secondary";
    default:
      return "outline";
  }
}

export function formatBadgeLabel(text: string) {
  return text.replace(/_/g, ' ');
}
