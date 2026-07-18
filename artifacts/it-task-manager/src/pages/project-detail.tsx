import { Link, useLocation } from "wouter";
import { useGetProject, useListTasks, useDeleteProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { EditProjectModal } from "@/components/ui/edit-project-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeAgo } from "@/lib/utils";
import { ArrowLeft, Calendar, Trash2, Edit, Plus, CheckSquare, Clock } from "lucide-react";
import { InlineNotes } from "@/components/notes/inline-notes";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const projectId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);

  const { data: project, isLoading: isLoadingProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: ["getProject", projectId] }
  });
  
  const { data: tasks, isLoading: isLoadingTasks } = useListTasks({ projectId }, {
    query: { enabled: !!projectId, queryKey: ["listTasks", { projectId }] }
  });

  const deleteMutation = useDeleteProject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project deleted successfully" });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setLocation("/projects");
      },
      onError: () => {
        toast({ title: "Failed to delete project", variant: "destructive" });
      }
    }
  });

  if (isLoadingProject) {
    return <div className="space-y-6 max-w-5xl mx-auto p-4"><Skeleton className="h-40 w-full" /></div>;
  }

  if (!project) {
    return <div className="text-center py-12">Project not found</div>;
  }

  const progress = project.taskCount ? Math.round(((project.completedTaskCount || 0) / project.taskCount) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <EditProjectModal open={editOpen} onOpenChange={setEditOpen} project={project} />
      {/* Header / Nav */}
      <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground mb-4">
        <Link href="/projects" className="hover:text-foreground flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Projects
        </Link>
        <span>/</span>
        <span className="text-foreground truncate">{project.name}</span>
      </div>

      {/* Project Details Card */}
      <Card className="border-border/60 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1 flex-1">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <Calendar className="w-3.5 h-3.5" />
                  Due: {project.dueDate ? formatDate(project.dueDate) : "No date"}
                </div>
                <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <Clock className="w-3.5 h-3.5" />
                  Updated: {formatTimeAgo(project.updatedAt)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={project.status} className="text-sm px-3 py-1" />
              <PriorityBadge priority={project.priority} className="text-sm px-3 py-1" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {project.description && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-relaxed">
              {project.description}
            </div>
          )}

          <div className="bg-card border border-border/50 rounded-lg p-4 mt-6">
            <div className="flex justify-between items-end mb-2">
              <div className="space-y-1">
                <span className="text-sm font-medium uppercase tracking-wider font-mono text-muted-foreground">Project Progress</span>
                <div className="text-2xl font-bold font-mono">{progress}%</div>
              </div>
              <div className="text-sm text-muted-foreground font-mono mb-1">
                {project.completedTaskCount || 0} of {project.taskCount || 0} Tasks Completed
              </div>
            </div>
            <div className="h-2.5 w-full bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4 border-t border-border/40">
            <Button variant="outline" size="sm" className="gap-2 font-mono uppercase text-xs" onClick={() => setEditOpen(true)}>
              <Edit className="w-3.5 h-3.5" /> Edit Project
            </Button>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2 font-mono uppercase text-xs" data-testid="btn-delete-project">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the project "{project.name}" and all associated tasks.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => deleteMutation.mutate({ id: project.id })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete Project"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Notes Section */}
      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-6">
          <InlineNotes projectId={projectId} />
        </CardContent>
      </Card>

      {/* Tasks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Project Tasks</h2>
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> Add Task
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoadingTasks ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : tasks && tasks.length > 0 ? (
              <div className="divide-y divide-border">
                {tasks.map(task => (
                  <div key={task.id} className="p-4 hover:bg-muted/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 text-muted-foreground">
                        <CheckSquare className="w-5 h-5" />
                      </div>
                      <div>
                        <Link href={`/tasks/${task.id}`}>
                          <span className="font-medium hover:text-primary transition-colors cursor-pointer text-sm">
                            {task.title}
                          </span>
                        </Link>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                          <span className="uppercase">{task.category}</span>
                          {task.assignee && (
                            <>
                              <span>•</span>
                              <span>{task.assignee}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 sm:ml-auto ml-8">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No tasks found for this project.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}