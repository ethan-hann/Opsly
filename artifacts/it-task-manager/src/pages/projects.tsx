import { useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useOrgContext } from "@/hooks/use-org-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FolderGit2, Calendar, X, Shield } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { NewProjectModal } from "@/components/ui/new-project-modal";
import { useTerminology } from "@/context/terminology-context";

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();
  const [showNewProject, setShowNewProject] = useState(false);
  const { hasPermission } = useOrgContext();
  const canManageProjects = hasPermission('manage_projects');
  const { t, tSingular } = useTerminology();

  // URL-driven status filter (e.g. ?status=active from the dashboard KPI card)
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(urlSearch);
  const statusFilter = params.get("status") ?? "";

  const clearStatusFilter = () => {
    const next = new URLSearchParams(urlSearch);
    next.delete("status");
    setLocation("?" + next.toString(), { replace: true });
  };

  const filteredProjects = statusFilter
    ? (projects ?? []).filter((p) => p.status === statusFilter)
    : (projects ?? []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("projects")}</h1>
          <p className="text-muted-foreground mt-1">Manage IT initiatives, deployments, and epics.</p>
        </div>
        {canManageProjects && (
          <Button className="gap-2" data-testid="button-create-project" onClick={() => setShowNewProject(true)}>
            <Plus className="w-4 h-4" />
            New {tSingular("projects")}
          </Button>
        )}
      </div>

      {/* Active filter banner */}
      {statusFilter && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
          <span className="text-primary font-medium capitalize">
            Showing {statusFilter} projects only
          </span>
          <button
            onClick={clearStatusFilter}
            className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary transition-colors"
          >
            <X className="w-3 h-3" />
            Clear filter
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)
        ) : filteredProjects.length > 0 ? (
          filteredProjects.map(project => {
            const progress = project.taskCount ? Math.round(((project.completedTaskCount || 0) / project.taskCount) * 100) : 0;
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start mb-2">
                      <FolderGit2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      <div className="flex gap-2 flex-wrap justify-end">
                        {project.hasSlaOverrides && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">
                            <Shield className="w-2.5 h-2.5" />
                            Custom SLA
                          </span>
                        )}
                        <StatusBadge status={project.status} />
                      </div>
                    </div>
                    <CardTitle className="text-lg line-clamp-1 group-hover:text-primary transition-colors">
                      {project.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                      {project.description || "No description provided."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-0 space-y-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {project.dueDate ? formatDate(project.dueDate) : "No Due Date"}
                      </div>
                      <PriorityBadge priority={project.priority} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 text-right">
                        {project.completedTaskCount || 0} / {project.taskCount || 0} {t("tasks").toUpperCase()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-xl bg-card/50">
            <FolderGit2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">
              {statusFilter ? `No ${statusFilter} ${t("projects").toLowerCase()}` : `No ${t("projects").toLowerCase()} found`}
            </h3>
            <p className="text-muted-foreground mb-4">
              {statusFilter
                ? `Try clearing the filter to see all ${t("projects").toLowerCase()}.`
                : `Get started by creating a new ${tSingular("projects").toLowerCase()} initiative.`}
            </p>
            {statusFilter ? (
              <Button variant="outline" className="gap-2" onClick={clearStatusFilter}>
                <X className="w-4 h-4" />
                Clear filter
              </Button>
            ) : canManageProjects ? (
              <Button variant="outline" className="gap-2" onClick={() => setShowNewProject(true)}>
                <Plus className="w-4 h-4" />
                Create {tSingular("projects")}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <NewProjectModal open={showNewProject} onOpenChange={setShowNewProject} />
    </div>
  );
}
