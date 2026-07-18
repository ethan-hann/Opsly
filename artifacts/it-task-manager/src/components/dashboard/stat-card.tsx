import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  trend?: {
    value: number;
    label: string;
    positive: boolean;
  };
  className?: string;
}

export function StatCard({ title, value, icon, description, trend, className }: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm shadow-sm", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight font-mono">{value}</div>
        {(description || trend) && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            {trend && (
              <span className={cn(
                "inline-flex items-center font-medium",
                trend.positive ? "text-emerald-500" : "text-destructive"
              )}>
                {trend.positive ? "+" : ""}{trend.value}%
              </span>
            )}
            {description && <span>{description}</span>}
            {trend && <span>{trend.label}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
