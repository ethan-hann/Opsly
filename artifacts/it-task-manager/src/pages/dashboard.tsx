import { Link } from "wouter";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useGetOverdueTasks,
  getGetOverdueTasksQueryKey,
  useListProjects,
  getListProjectsQueryKey,
  useGetSLAPolicies,
  useGetDashboardSlaSummary,
  getGetDashboardSlaSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  Briefcase, CheckCircle2, Clock, ShieldAlert,
  Activity, LayoutGrid, ArrowRight, ShieldCheck,
} from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { getSlaStatus } from "@/lib/sla";
import { formatTimeAgo, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { data: overdueTasks, isLoading: isLoadingOverdue } = useGetOverdueTasks({
    query: { queryKey: getGetOverdueTasksQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { data: projects, isLoading: isLoadingProjects } = useListProjects({
    query: { queryKey: getListProjectsQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const { data: slaPolicies } = useGetSLAPolicies();
  const { data: slaSummary, isLoading: isLoadingSlaSummary } = useGetDashboardSlaSummary(
    { period: "30d" },
    { query: { queryKey: getGetDashboardSlaSummaryQueryKey({ period: "30d" }), refetchInterval: 30_000, refetchOnWindowFocus: true } },
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];

  // Compute SLA-breached tasks from the overdue list (fire once policies are available)
  const slaBreachedTasks = (overdueTasks ?? []).filter((task) => {
    if (task.stageType === "closed") return false;
    const policy = slaPolicies?.find((p) => p.priority === task.priority) ?? null;
    const result = getSlaStatus(task.createdAt, task.status, task.priority, policy, task.stageType as "open" | "closed" | undefined);
    return result.isResolutionBreached;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">System Status</h1>
          <p className="text-stone-500 dark:text-stone-400 mt-1">{greeting}. Here's what needs your attention today.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" className="font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 border-0">
              Manage Projects
            </Button>
          </Link>
          <Link href="/tasks">
            <Button className="font-medium bg-amber-600 hover:bg-amber-700 text-white shadow-sm gap-2">
              View All Tasks
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {isLoadingSummary ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : summary ? (
          <>
            <Link href="/projects">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-amber-200 dark:hover:border-amber-700 transition-all group cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Active Projects</p>
                    <p className="text-3xl font-bold text-stone-800 dark:text-stone-100 mt-2">{summary.activeProjects}</p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Out of {summary.totalProjects} total</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 group-hover:scale-110 transition-transform">
                    <Briefcase className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-amber-200 dark:hover:border-amber-700 transition-all group cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Open Tasks</p>
                    <p className="text-3xl font-bold text-stone-800 dark:text-stone-100 mt-2">
                      {summary.tasksByStageType.open}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Requires attention</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 group-hover:scale-110 transition-transform">
                    <LayoutGrid className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-700 transition-all group cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Closed Tasks</p>
                    <p className="text-3xl font-bold text-stone-800 dark:text-stone-100 mt-2">
                      {summary.tasksByStageType.closed}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Resolved</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks">
              <div className={`bg-white dark:bg-stone-900 rounded-2xl p-6 border shadow-sm hover:shadow-md transition-all group cursor-pointer ${
                summary.overdueCount > 0
                  ? "border-orange-200 dark:border-orange-800 hover:border-orange-300 dark:hover:border-orange-700"
                  : "border-stone-200 dark:border-stone-700 hover:border-amber-200 dark:hover:border-amber-700"
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Overdue Tasks</p>
                    <p className={`text-3xl font-bold mt-2 ${summary.overdueCount > 0 ? "text-orange-600 dark:text-orange-400" : "text-stone-800 dark:text-stone-100"}`}>
                      {summary.overdueCount}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform ${
                    summary.overdueCount > 0
                      ? "bg-orange-100 text-orange-500 dark:bg-orange-900/40 dark:text-orange-400"
                      : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
                  }`}>
                    <Clock className="w-6 h-6" />
                  </div>
                </div>
              </div>
            </Link>
          </>
        ) : null}

        {/* SLA Compliance KPI card — loads independently */}
        {isLoadingSlaSummary ? (
          <Skeleton className="h-28 rounded-2xl" />
        ) : slaSummary ? (
          <Link href="/tasks">
            <div className={`bg-white dark:bg-stone-900 rounded-2xl p-6 border shadow-sm hover:shadow-md transition-all group cursor-pointer ${
              slaSummary.complianceRate >= 90
                ? "border-emerald-200 dark:border-emerald-800 hover:border-emerald-300 dark:hover:border-emerald-700"
                : slaSummary.complianceRate >= 70
                  ? "border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700"
                  : "border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700"
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-500 dark:text-stone-400">SLA Compliance</p>
                  <p className={`text-3xl font-bold mt-2 ${
                    slaSummary.complianceRate >= 90
                      ? "text-emerald-600 dark:text-emerald-400"
                      : slaSummary.complianceRate >= 70
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  }`}>
                    {slaSummary.complianceRate}%
                  </p>
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                    {slaSummary.totalTracked === 0
                      ? "No tracked tasks"
                      : `${slaSummary.breachedCount} breached · 30d`}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform ${
                  slaSummary.complianceRate >= 90
                    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                    : slaSummary.complianceRate >= 70
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
                      : "bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-400"
                }`}>
                  <ShieldCheck className="w-6 h-6" />
                </div>
              </div>
            </div>
          </Link>
        ) : null}
      </div>

      {/* SLA Compliance Detail Panel */}
      {slaSummary && slaSummary.totalTracked > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-stone-400 dark:text-stone-500" />
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">SLA Compliance — Last 30 Days</h2>
            </div>
            <div className="flex items-center gap-4 text-sm text-stone-500 dark:text-stone-400">
              {slaSummary.avgBreachMinutes != null && (
                <span className="text-red-600 dark:text-red-400 font-medium">
                  Avg overshoot: {slaSummary.avgBreachMinutes >= 60
                    ? `${Math.round(slaSummary.avgBreachMinutes / 60 * 10) / 10}h`
                    : `${Math.round(slaSummary.avgBreachMinutes)}m`}
                </span>
              )}
              <span>{slaSummary.withinSlaCount} within target · {slaSummary.breachedCount} breached · {slaSummary.totalTracked} total</span>
            </div>
          </div>

          {/* Per-priority breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {slaSummary.byPriority.filter(p => p.totalTracked > 0).map((p) => {
              const isGood = p.complianceRate >= 90;
              const isMid = p.complianceRate >= 70;
              return (
                <div key={p.priority} className={`rounded-xl p-4 border ${
                  isGood
                    ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40"
                    : isMid
                      ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40"
                      : "bg-red-50/60 dark:bg-red-950/20 border-red-100 dark:border-red-900/40"
                }`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2 capitalize">{p.priority}</p>
                  <p className={`text-2xl font-bold ${
                    isGood ? "text-emerald-600 dark:text-emerald-400" : isMid ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                  }`}>{p.complianceRate}%</p>
                  <div className="mt-2 w-full h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isGood ? "bg-emerald-500" : isMid ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${p.complianceRate}%` }}
                    />
                  </div>
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">
                    {p.breachedCount > 0 ? `${p.breachedCount} breached` : "No breaches"} · {p.totalTracked} total
                  </p>
                </div>
              );
            })}
            {slaSummary.byPriority.every(p => p.totalTracked === 0) && (
              <div className="col-span-4 text-center py-4 text-stone-400 dark:text-stone-500 text-sm">
                No SLA data for this period.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left 2 columns */}
        <div className="lg:col-span-2 space-y-8">

          {/* SLA Breached Tasks */}
          {slaBreachedTasks.length > 0 && (
            <div className="bg-white dark:bg-stone-900 rounded-2xl border border-red-200 dark:border-red-900 shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-red-100 dark:border-red-900/60 flex items-center justify-between bg-red-50/40 dark:bg-red-950/20">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                  <h2 className="text-lg font-semibold text-red-900 dark:text-red-300">SLA Breached</h2>
                  <span className="ml-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400">
                    {slaBreachedTasks.length}
                  </span>
                </div>
                <p className="text-sm text-stone-400 dark:text-stone-500">Resolution time exceeded</p>
              </div>
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {slaBreachedTasks.slice(0, 5).map(task => (
                  <div key={task.id} className="p-5 hover:bg-red-50/30 dark:hover:bg-red-950/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <div className="mt-0.5 p-2 rounded-lg bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 shrink-0">
                        <ShieldAlert className="w-4 h-4" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <Link href={`/tasks/${task.id}`}>
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 hover:text-amber-700 dark:hover:text-amber-400 transition-colors cursor-pointer truncate">
                            {task.title}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                          <span>{task.projectName || "Unassigned"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center flex-wrap gap-2 shrink-0">
                      <SlaBadge
                        createdAt={task.createdAt}
                        status={task.status}
                        priority={task.priority}
                        policies={slaPolicies}
                      />
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attention Required */}
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between bg-rose-50/40 dark:bg-rose-950/20">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <h2 className="text-lg font-semibold text-rose-900 dark:text-rose-300">Attention Required</h2>
              </div>
              <p className="text-sm text-stone-400 dark:text-stone-500">Overdue or critical priority tasks</p>
            </div>

            {isLoadingOverdue ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : overdueTasks && overdueTasks.length > 0 ? (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {overdueTasks.slice(0, 5).map(task => (
                  <div key={task.id} className="p-5 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <div className="mt-0.5 p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400 shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <Link href={`/tasks/${task.id}`}>
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 hover:text-amber-700 dark:hover:text-amber-400 transition-colors cursor-pointer truncate">
                            {task.title}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                          <span className="text-xs">{task.projectName || "Unassigned"}</span>
                          <span>·</span>
                          {task.dueDate ? (
                            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs">
                              <Clock className="w-3 h-3" />
                              Due {formatDate(task.dueDate)}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
                              Critical priority
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center flex-wrap gap-2 shrink-0">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-stone-400 dark:text-stone-500 flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 opacity-60" />
                <p className="text-sm">No overdue or critical tasks. System nominal.</p>
              </div>
            )}
          </div>

          {/* Active Projects */}
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">Active Projects</h2>
                <p className="text-sm text-stone-400 dark:text-stone-500">Ongoing operational streams</p>
              </div>
              <Link href="/projects">
                <button className="p-2 text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                  <LayoutGrid className="w-5 h-5" />
                </button>
              </Link>
            </div>

            {isLoadingProjects ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
            ) : activeProjects.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeProjects.slice(0, 4).map(project => {
                  const progress = project.taskCount
                    ? Math.round(((project.completedTaskCount || 0) / project.taskCount) * 100)
                    : 0;
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="p-4 rounded-xl border border-stone-100 dark:border-stone-700/50 bg-stone-50/50 dark:bg-stone-800/30 hover:bg-amber-50/40 dark:hover:bg-amber-900/10 hover:border-amber-200 dark:hover:border-amber-700/50 transition-all cursor-pointer group">
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 group-hover:text-amber-800 dark:group-hover:text-amber-400 transition-colors line-clamp-1">
                            {project.name}
                          </h3>
                          <PriorityBadge priority={project.priority} />
                        </div>
                        <div className="mb-3">
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-stone-500 dark:text-stone-400 font-medium">Progress</span>
                            <span className="text-stone-700 dark:text-stone-300 font-bold">{progress}%</span>
                          </div>
                          <div className="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-stone-400 dark:text-stone-500 pt-2.5 border-t border-stone-100 dark:border-stone-700/50">
                          <span>{project.completedTaskCount || 0}/{project.taskCount || 0} tasks</span>
                          <span>{progress}% complete</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400 dark:text-stone-500 text-sm">
                No active projects.
              </div>
            )}
          </div>
        </div>

        {/* Activity Log */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6 sticky top-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">Activity Log</h2>
              <Activity className="w-5 h-5 text-stone-400 dark:text-stone-500" />
            </div>

            {isLoadingActivity ? (
              <div className="space-y-5">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-5 relative before:absolute before:inset-0 before:ml-[9px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-stone-200 before:via-stone-200 dark:before:from-stone-700 dark:before:via-stone-700 before:to-transparent">
                {activity.slice(0, 10).map((item) => {
                  const href = item.entityType === "project"
                    ? `/projects/${item.entityId}`
                    : `/tasks/${item.entityId}`;
                  return (
                    <div key={item.id} className="relative flex items-start gap-4">
                      <div className="absolute left-0 mt-1 flex items-center justify-center z-10">
                        <div className="w-5 h-5 rounded-full border-4 border-white dark:border-stone-900 bg-amber-400 dark:bg-amber-500 shrink-0" />
                      </div>
                      <div className="ml-8 space-y-0.5">
                        <p className="text-sm text-stone-600 dark:text-stone-400">
                          <Link href={href}>
                            <span className="font-medium text-stone-800 dark:text-stone-200 hover:text-amber-700 dark:hover:text-amber-400 transition-colors cursor-pointer">
                              {item.title}
                            </span>
                          </Link>
                        </p>
                        <span className="text-xs text-stone-400 dark:text-stone-500 font-medium">
                          {formatTimeAgo(item.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400 dark:text-stone-500 text-sm">
                No recent activity.
              </div>
            )}

            {activity && activity.length > 0 && (
              <Link href="/tasks">
                <button className="w-full mt-8 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-xl transition-colors">
                  View All Tasks
                </button>
              </Link>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
