import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  href?: string;
  trend?: {
    value: number;
    label: string;
    positive: boolean;
  };
  className?: string;
}

export function StatCard({ title, value, icon, description, href, trend, className }: StatCardProps) {
  const card = (
    <Card className={cn(
      "overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm shadow-sm",
      href && "transition-colors hover:border-primary/40 hover:bg-card cursor-pointer",
      className,
    )}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
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

  if (href) {
    return <Link href={href}>{card}</Link>;
  }
  return card;
}
