import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, CheckSquare, TrendingUp, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-usage"],
    queryFn: fetchUsage,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{t('admin.usage.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('admin.usage.subtitle')}
            {dataUpdatedAt > 0 && (
              <> {t('admin.usage.lastUpdated', { time: new Date(dataUpdatedAt).toLocaleTimeString() })}</>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          {t('admin.usage.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label={t('admin.usage.totalOrgs')}
          value={data?.totalOrgs}
          sub={t('admin.usage.totalOrgsDesc')}
        />
        <StatCard
          icon={Users}
          label={t('admin.usage.totalUsers')}
          value={data?.totalUsers}
          sub={t('admin.usage.totalUsersDesc')}
        />
        <StatCard
          icon={CheckSquare}
          label={t('admin.usage.totalTasks')}
          value={data?.totalTasks}
          sub={t('admin.usage.totalTasksDesc')}
        />
        <StatCard
          icon={TrendingUp}
          label={t('admin.usage.tasksLast30')}
          value={data?.tasksLast30Days}
          sub={t('admin.usage.tasksLast30Desc')}
        />
      </div>
    </div>
  );
}
