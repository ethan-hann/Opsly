import { useState } from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useOrgContext } from "@/hooks/use-org-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FolderGit2, Calendar } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { NewProjectModal } from "@/components/ui/new-project-modal";

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();
  const [showNewProject, setShowNewProject] = useState(false);
  const { hasPermission } = useOrgContext();
  const canManageProjects = hasPermission('manage_projects');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">Manage IT initiatives, deployments, and epics.</p>
        </div>
        {canManageProjects && (
          <Button className="gap-2" data-testid="button-create-project" onClick={() => setShowNewProject(true)}>
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)
        ) : projects && projects.length > 0 ? (
          projects.map(project => {
            const progress = project.taskCount ? Math.round(((project.completedTaskCount || 0) / project.taskCount) * 100) : 0;
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start mb-2">
                      <FolderGit2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      <div className="flex gap-2">
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
                        {project.completedTaskCount || 0} / {project.taskCount || 0} TASKS
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-xl bg-card/50">
            <FolderGit2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">No projects found</h3>
            <p className="text-muted-foreground mb-4">Get started by creating a new project initiative.</p>
            {canManageProjects && (
              <Button variant="outline" className="gap-2" onClick={() => setShowNewProject(true)}>
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            )}
          </div>
        )}
      </div>

      <NewProjectModal open={showNewProject} onOpenChange={setShowNewProject} />
    </div>
  );
}
