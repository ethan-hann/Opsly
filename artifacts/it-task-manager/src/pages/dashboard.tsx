import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { useTerminology } from "@/context/terminology-context";
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

type SlaPeriod = "7d" | "30d" | "90d" | "all";

// Labels are computed inside the component using t(); this array holds i18n keys
const SLA_PERIOD_KEYS: { value: SlaPeriod; labelKey: string; headingKey: string }[] = [
  { value: "7d",  labelKey: "dashboard.last7d",  headingKey: "dashboard.last7dHeading" },
  { value: "30d", labelKey: "dashboard.last30d", headingKey: "dashboard.last30dHeading" },
  { value: "90d", labelKey: "dashboard.last90d", headingKey: "dashboard.last90dHeading" },
  { value: "all", labelKey: "dashboard.allTime", headingKey: "dashboard.allTimeHeading" },
];

export default function Dashboard() {
  const { t: term } = useTerminology();
  const { t, i18n } = useTranslation();
  const [slaPeriod, setSlaPeriod] = useState<SlaPeriod>("30d");

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
    { period: slaPeriod },
    { query: { queryKey: getGetDashboardSlaSummaryQueryKey({ period: slaPeriod }), refetchInterval: 30_000, refetchOnWindowFocus: true } },
  );

  const SLA_PERIOD_OPTIONS = SLA_PERIOD_KEYS.map(k => ({
    value: k.value,
    label: t(k.labelKey),
    heading: t(k.headingKey),
  }));

  const activePeriod = SLA_PERIOD_OPTIONS.find(o => o.value === slaPeriod)!;

  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? "dashboard.greetingMorning" : hour < 18 ? "dashboard.greetingAfternoon" : "dashboard.greetingEvening";
  const greeting = t(greetingKey) + t('dashboard.greetingSuffix');

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
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">{t('dashboard.title')}</h1>
          <p className="text-stone-500 dark:text-stone-400 mt-1">{greeting}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" className="font-medium text-primary bg-primary/10 hover:bg-primary/20 border-0">
              {t('dashboard.manageProjects', { projects: term('projects') })}
            </Button>
          </Link>
          <Link href="/tasks">
            <Button className="font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm gap-2">
              {t('dashboard.viewAllTasks', { tasks: term('tasks') })}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards — 2 cols on mobile, 5 across from lg onwards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 xl:gap-4">
        {isLoadingSummary ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : summary ? (
          <>
            <Link href="/projects?status=active">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-4 xl:p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group cursor-pointer h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm font-medium text-stone-500 dark:text-stone-400 leading-tight">{t('dashboard.activeProjects', { projects: term('projects') })}</p>
                    <p className="text-2xl xl:text-3xl font-bold text-stone-800 dark:text-stone-100 mt-1.5">{summary.activeProjects}</p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 hidden sm:block">{t('dashboard.activeProjectsOutOf', { total: summary.totalProjects })}</p>
                  </div>
                  <div className="w-9 h-9 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center bg-primary/10 text-primary group-hover:scale-110 transition-transform shrink-0">
                    <Briefcase className="w-4 h-4 xl:w-6 xl:h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks?stageType=open">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-4 xl:p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group cursor-pointer h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm font-medium text-stone-500 dark:text-stone-400 leading-tight">{t('dashboard.openTasks', { tasks: term('tasks') })}</p>
                    <p className="text-2xl xl:text-3xl font-bold text-stone-800 dark:text-stone-100 mt-1.5">
                      {summary.tasksByStageType.open}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 hidden sm:block">{t('dashboard.openTasksRequires')}</p>
                  </div>
                  <div className="w-9 h-9 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center bg-primary/10 text-primary group-hover:scale-110 transition-transform shrink-0">
                    <LayoutGrid className="w-4 h-4 xl:w-6 xl:h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks?stageType=closed">
              <div className="bg-white dark:bg-stone-900 rounded-2xl p-4 xl:p-6 border border-stone-200 dark:border-stone-700 shadow-sm hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-700 transition-all group cursor-pointer h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm font-medium text-stone-500 dark:text-stone-400 leading-tight">{t('dashboard.closedTasks', { tasks: term('tasks') })}</p>
                    <p className="text-2xl xl:text-3xl font-bold text-stone-800 dark:text-stone-100 mt-1.5">
                      {summary.tasksByStageType.closed}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 hidden sm:block">{t('dashboard.closedTasksResolved')}</p>
                  </div>
                  <div className="w-9 h-9 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 group-hover:scale-110 transition-transform shrink-0">
                    <CheckCircle2 className="w-4 h-4 xl:w-6 xl:h-6" />
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/tasks?overdue=true">
              <div className={`bg-white dark:bg-stone-900 rounded-2xl p-4 xl:p-6 border shadow-sm hover:shadow-md transition-all group cursor-pointer h-full ${
                summary.overdueCount > 0
                  ? "border-orange-200 dark:border-orange-800 hover:border-orange-300 dark:hover:border-orange-700"
                  : "border-stone-200 dark:border-stone-700 hover:border-primary/30"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs xl:text-sm font-medium text-stone-500 dark:text-stone-400 leading-tight">{t('dashboard.overdueTasks', { tasks: term('tasks') })}</p>
                    <p className={`text-2xl xl:text-3xl font-bold mt-1.5 ${summary.overdueCount > 0 ? "text-orange-600 dark:text-orange-400" : "text-stone-800 dark:text-stone-100"}`}>
                      {summary.overdueCount}
                    </p>
                  </div>
                  <div className={`w-9 h-9 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shrink-0 ${
                    summary.overdueCount > 0
                      ? "bg-orange-100 text-orange-500 dark:bg-orange-900/40 dark:text-orange-400"
                      : "bg-primary/10 text-primary"
                  }`}>
                    <Clock className="w-4 h-4 xl:w-6 xl:h-6" />
                  </div>
                </div>
              </div>
            </Link>
          </>
        ) : null}

        {/* SLA Compliance KPI card — loads independently */}
        {isLoadingSlaSummary ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : slaSummary ? (
          <Link href="/tasks?slaBreached=true">
            <div className={`bg-white dark:bg-stone-900 rounded-2xl p-4 xl:p-6 border shadow-sm hover:shadow-md transition-all group cursor-pointer h-full ${
              slaSummary.complianceRate >= 90
                ? "border-emerald-200 dark:border-emerald-800 hover:border-emerald-300 dark:hover:border-emerald-700"
                : slaSummary.complianceRate >= 70
                  ? "border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700"
                  : "border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs xl:text-sm font-medium text-stone-500 dark:text-stone-400 leading-tight">{t('dashboard.slaCompliance')}</p>
                  <p className={`text-2xl xl:text-3xl font-bold mt-1.5 ${
                    slaSummary.complianceRate >= 90
                      ? "text-emerald-600 dark:text-emerald-400"
                      : slaSummary.complianceRate >= 70
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  }`}>
                    {slaSummary.complianceRate}%
                  </p>
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-1 hidden sm:block">
                    {slaSummary.totalTracked === 0
                      ? t('dashboard.noTrackedTasks')
                      : t('dashboard.breachedCount', { count: slaSummary.breachedCount, period: activePeriod.label })}
                  </p>
                </div>
                <div className={`w-9 h-9 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shrink-0 ${
                  slaSummary.complianceRate >= 90
                    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
                    : slaSummary.complianceRate >= 70
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
                      : "bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-400"
                }`}>
                  <ShieldCheck className="w-4 h-4 xl:w-6 xl:h-6" />
                </div>
              </div>
            </div>
          </Link>
        ) : null}
      </div>

      {/* SLA Compliance Detail Panel — always visible when data is loaded so the
           period selector remains accessible even when a period has zero tasks */}
      {(isLoadingSlaSummary || slaSummary) && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
          {/* Header: title + segmented control always rendered */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-5 h-5 text-stone-400 dark:text-stone-500 shrink-0" />
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100 truncate">
                {t('dashboard.slaCompliancePeriod', { period: activePeriod.heading })}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {/* Period segmented control — always visible */}
              <div className="flex items-center rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-xs font-medium">
                {SLA_PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSlaPeriod(opt.value)}
                    className={`px-3 py-1.5 transition-colors ${
                      slaPeriod === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {slaSummary && slaSummary.totalTracked > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                  {slaSummary.avgBreachMinutes != null && (
                    <span className="text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
                      {t('dashboard.avgOvershoot')} {slaSummary.avgBreachMinutes >= 60
                        ? `${Math.round(slaSummary.avgBreachMinutes / 60 * 10) / 10}h`
                        : `${Math.round(slaSummary.avgBreachMinutes)}m`}
                    </span>
                  )}
                  <span className="whitespace-nowrap">{slaSummary.withinSlaCount} {t('dashboard.withinSla')} · {slaSummary.breachedCount} {t('dashboard.breaches')} · {slaSummary.totalTracked} {t('common.total')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Per-priority breakdown */}
          {isLoadingSlaSummary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array(4).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : slaSummary && slaSummary.totalTracked > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {slaSummary.byPriority.filter(p => p.totalTracked > 0).map((p) => {
                const isGood = p.complianceRate >= 90;
                const isMid = p.complianceRate >= 70;
                return (
                  <Link key={p.priority} href={p.breachedCount > 0 ? `/tasks?slaBreached=true&priority=${p.priority}` : "#"}>
                  <div className={`rounded-xl p-4 border cursor-pointer ${p.breachedCount > 0 ? "hover:opacity-80 transition-opacity" : ""} ${
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
                      {p.breachedCount > 0 ? `${p.breachedCount} ${t('dashboard.breaches')}` : t('dashboard.noBreaches')} · {p.totalTracked} {t('common.total')}
                    </p>
                  </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-stone-400 dark:text-stone-500 text-sm flex flex-col items-center gap-2">
              <ShieldCheck className="w-7 h-7 opacity-30" />
              <p>{t('dashboard.noSlaData')}</p>
            </div>
          )}
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
                  <h2 className="text-lg font-semibold text-red-900 dark:text-red-300">{t('dashboard.slaBreached')}</h2>
                  <span className="ml-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400">
                    {slaBreachedTasks.length}
                  </span>
                </div>
                <p className="text-sm text-stone-400 dark:text-stone-500">{t('dashboard.resolutionTimeExceeded')}</p>
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
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 hover:text-primary transition-colors cursor-pointer truncate">
                            {task.title}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                          <span>{task.projectName || t('common.unassigned')}</span>
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
                      <StatusBadge status={task.status} stageName={task.stageName} stageColor={task.stageColor} stageArchived={task.stageArchived} />
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
                <h2 className="text-lg font-semibold text-rose-900 dark:text-rose-300">{t('dashboard.attentionRequired')}</h2>
              </div>
              <p className="text-sm text-stone-400 dark:text-stone-500">{t('dashboard.overdueOrCritical')}</p>
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
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 hover:text-primary transition-colors cursor-pointer truncate">
                            {task.title}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                          <span className="text-xs">{task.projectName || t('common.unassigned')}</span>
                          <span>·</span>
                          {task.dueDate ? (
                            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs">
                              <Clock className="w-3 h-3" />
                              {t('dashboard.dueOn', { date: formatDate(task.dueDate, i18n.language) })}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
                              {t('dashboard.criticalPriority')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center flex-wrap gap-2 shrink-0">
                      <StatusBadge status={task.status} stageName={task.stageName} stageColor={task.stageColor} stageArchived={task.stageArchived} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-stone-400 dark:text-stone-500 flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 opacity-60" />
                <p className="text-sm">{t('dashboard.noOverdueTasks')}</p>
              </div>
            )}
          </div>

          {/* Active Projects */}
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">{t('dashboard.activeProjectsSection', { projects: term('projects') })}</h2>
                <p className="text-sm text-stone-400 dark:text-stone-500">{t('dashboard.ongoingStreams')}</p>
              </div>
              <Link href="/projects">
                <button className="p-2 text-stone-400 hover:text-primary rounded-lg hover:bg-primary/5 transition-colors">
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
                      <div className="p-4 rounded-xl border border-stone-100 dark:border-stone-700/50 bg-stone-50/50 dark:bg-stone-800/30 hover:bg-primary/5 hover:border-primary/20 transition-all cursor-pointer group">
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-medium text-stone-800 dark:text-stone-200 group-hover:text-primary transition-colors line-clamp-1">
                            {project.name}
                          </h3>
                          <PriorityBadge priority={project.priority} />
                        </div>
                        <div className="mb-3">
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-stone-500 dark:text-stone-400 font-medium">{t('common.progress')}</span>
                            <span className="text-stone-700 dark:text-stone-300 font-bold">{progress}%</span>
                          </div>
                          <div className="w-full h-2 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-stone-400 dark:text-stone-500 pt-2.5 border-t border-stone-100 dark:border-stone-700/50">
                          <span>{t('dashboard.tasksCount', { completed: project.completedTaskCount || 0, total: project.taskCount || 0, tasks: term('tasks').toLowerCase() })}</span>
                          <span>{progress}% {t('common.complete')}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400 dark:text-stone-500 text-sm">
                {t('dashboard.noActiveProjects', { projects: term('projects').toLowerCase() })}
              </div>
            )}
          </div>
        </div>

        {/* Activity Log */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm p-6 sticky top-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">{t('dashboard.activityLog')}</h2>
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
                        <div className="w-5 h-5 rounded-full border-4 border-white dark:border-stone-900 bg-primary shrink-0" />
                      </div>
                      <div className="ml-8 space-y-0.5">
                        <p className="text-sm text-stone-600 dark:text-stone-400">
                          <Link href={href}>
                            <span className="font-medium text-stone-800 dark:text-stone-200 hover:text-primary transition-colors cursor-pointer">
                              {item.title}
                            </span>
                          </Link>
                        </p>
                        <span className="text-xs text-stone-400 dark:text-stone-500 font-medium">
                          {formatTimeAgo(item.createdAt, i18n.language)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-stone-400 dark:text-stone-500 text-sm">
                {t('dashboard.noRecentActivity')}
              </div>
            )}

            {activity && activity.length > 0 && (
              <Link href="/tasks">
                <button className="w-full mt-8 py-2.5 text-sm font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-xl transition-colors">
                  {t('dashboard.viewAllTasks', { tasks: term('tasks') })}
                </button>
              </Link>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
