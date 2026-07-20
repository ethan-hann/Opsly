import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, CheckSquare, TrendingUp, RefreshCw } from "lucide-react";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface UsageMetrics {
  totalOrgs: number;
  totalUsers: number;
  totalTasks: number;
  tasksLast30Days: number;
}

async function fetchUsage(): Promise<UsageMetrics> {
  const res = await fetch(`${BASE}/api/admin/usage`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load usage");
  return res.json();
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="w-4 h-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">
          {value === undefined ? (
            <div className="h-9 w-20 bg-muted animate-pulse rounded" />
          ) : (
            value.toLocaleString()
          )}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function AdminUsageTab() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-usage"],
    queryFn: fetchUsage,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Instance Metrics</h2>
          <p className="text-sm text-muted-foreground">
            Live summary from the database.
            {dataUpdatedAt > 0 && (
              <> Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}.</>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="Total Organizations"
          value={data?.totalOrgs}
          sub="All orgs including suspended"
        />
        <StatCard
          icon={Users}
          label="Total Users"
          value={data?.totalUsers}
          sub="Across all organizations"
        />
        <StatCard
          icon={CheckSquare}
          label="Total Tasks"
          value={data?.totalTasks}
          sub="All time, all orgs"
        />
        <StatCard
          icon={TrendingUp}
          label="Tasks (last 30 days)"
          value={data?.tasksLast30Days}
          sub="New tasks in the past month"
        />
      </div>
    </div>
  );
}
