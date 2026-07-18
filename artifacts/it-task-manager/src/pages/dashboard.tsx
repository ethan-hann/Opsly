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
} from "@workspace/api-client-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Clock, Activity, Target, AlertTriangle } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatTimeAgo, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  // Dashboard queries poll every 30 s and refetch on window focus so the
  // overview stays current without the user manually refreshing.
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
          <p className="text-muted-foreground mt-1">Overview of IT operations, deployments, and incidents.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks">
            <Button variant="outline" size="sm" className="font-mono text-xs uppercase">View All Tasks</Button>
          </Link>
          <Link href="/projects">
            <Button variant="default" size="sm" className="font-mono text-xs uppercase">Manage Projects</Button>
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoadingSummary ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        ) : summary ? (
          <>
            <StatCard 
              title="Active Projects" 
              value={summary.activeProjects} 
              icon={<Target className="w-4 h-4" />} 
              description={`Out of ${summary.totalProjects} total`}
              className="border-primary/20"
            />
            <StatCard 
              title="Open Tasks" 
              value={summary.tasksByStatus.todo + summary.tasksByStatus.in_progress} 
              icon={<CheckCircle2 className="w-4 h-4" />} 
              description="Requires attention"
            />
            <StatCard 
              title="Blocked Issues" 
              value={summary.tasksByStatus.blocked} 
              icon={<AlertCircle className="w-4 h-4 text-amber-500" />} 
              className={summary.tasksByStatus.blocked > 0 ? "border-amber-500/50 bg-amber-500/5" : ""}
            />
            <StatCard 
              title="Overdue Tasks" 
              value={summary.overdueCount} 
              icon={<Clock className="w-4 h-4 text-destructive" />} 
              className={summary.overdueCount > 0 ? "border-destructive/50 bg-destructive/5" : ""}
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area - Left 2 Columns */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Critical & High Priority Overview */}
          <Card className="border-destructive/20 shadow-sm overflow-hidden">
            <CardHeader className="bg-destructive/5 border-b border-destructive/10 pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Attention Required
              </CardTitle>
              <CardDescription>Overdue or critical priority tasks</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingOverdue ? (
                <div className="p-6 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : overdueTasks && overdueTasks.length > 0 ? (
                <div className="divide-y divide-border">
                  {overdueTasks.slice(0, 5).map(task => (
                    <div key={task.id} className="p-4 flex flex-col sm:flex-row gap-4 justify-between hover:bg-muted/50 transition-colors">
                      <div className="space-y-1">
                        <Link href={`/tasks/${task.id}`}>
                          <div className="font-medium text-sm hover:underline cursor-pointer flex items-center gap-2">
                            {task.title}
                          </div>
                        </Link>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="font-mono">{task.projectName || 'Unassigned'}</span>
                          <span>•</span>
                          <span className="text-destructive flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Due {formatDate(task.dueDate)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={task.status} />
                        <PriorityBadge priority={task.priority} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 opacity-50" />
                  <p>No overdue or critical tasks. System nominal.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Projects Quick View */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Projects</CardTitle>
              <CardDescription>Ongoing operational streams</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingProjects ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : projects && projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.filter(p => p.status === 'active').slice(0, 4).map(project => {
                    const progress = project.taskCount ? Math.round(((project.completedTaskCount || 0) / project.taskCount) * 100) : 0;
                    return (
                      <Link key={project.id} href={`/projects/${project.id}`}>
                        <div className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors cursor-pointer group">
                          <div className="flex justify-between items-start mb-2">
                            <h3 className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-1">{project.name}</h3>
                            <PriorityBadge priority={project.priority} />
                          </div>
                          <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground font-mono">
                              <span>{project.completedTaskCount || 0}/{project.taskCount || 0} Tasks</span>
                              <span>{progress}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary rounded-full transition-all duration-500" 
                                style={{ width: `${progress}%` }} 
                              />
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No active projects.
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Sidebar Area - Right Column */}
        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              {isLoadingActivity ? (
                <div className="space-y-4">
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="w-2 h-2 rounded-full mt-2" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activity && activity.length > 0 ? (
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[5px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  {activity.slice(0, 10).map((item) => {
                    const href = item.entityType === "project"
                      ? `/projects/${item.entityId}`
                      : `/tasks/${item.entityId}`;
                    return (
                      <div key={item.id} className="relative flex items-start gap-4">
                        <div className="absolute left-0 mt-1.5 w-3 h-3 rounded-full bg-background border-2 border-primary z-10" />
                        <div className="ml-6 space-y-1">
                          <p className="text-sm">
                            <Link href={href}>
                              <span className="font-medium text-foreground hover:text-primary hover:underline cursor-pointer transition-colors">
                                {item.title}
                              </span>
                            </Link>
                          </p>
                          <div className="text-xs text-muted-foreground font-mono">
                            {formatTimeAgo(item.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No recent activity.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
