import { Link, useLocation, useSearch } from "wouter";
import {
  useGetProject, useListTasks, useDeleteProject, getListProjectsQueryKey,
  useGetProjectSLAPolicies, useUpsertProjectSLAPolicies, useGetSLAPolicies,
} from "@workspace/api-client-react";
import type { SlaPolicy } from "@workspace/api-client-react";
import { EditProjectModal } from "@/components/ui/edit-project-modal";
import { NewTaskModal } from "@/components/ui/new-task-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeAgo } from "@/lib/utils";
import { ArrowLeft, Calendar, Pencil, Timer, Trash2, Edit, Plus, CheckSquare, Clock } from "lucide-react";
import { InlineNotes } from "@/components/notes/inline-notes";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useOrgContext } from "@/hooks/use-org-context";
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

// ─── SLA policy helpers ───────────────────────────────────────────────────────

const PRIORITY_LEVELS = [
  { value: "critical" as const, label: "Critical" },
  { value: "high"     as const, label: "High"     },
  { value: "medium"   as const, label: "Medium"   },
  { value: "low"      as const, label: "Low"      },
];

type PriorityLevel = typeof PRIORITY_LEVELS[number]["value"];

interface PolicyDraft {
  responseMinutes: string;
  resolutionMinutes: string;
}

function minutesToDisplay(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}
function displayToMinutes(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ─── ProjectSlaPoliciesCard ───────────────────────────────────────────────────

function ProjectSlaPoliciesCard({ projectId }: { projectId: number }) {
  const { toast } = useToast();

  const { data: projectPolicies, isLoading: isLoadingProject, refetch: refetchProject } =
    useGetProjectSLAPolicies(projectId);
  const { data: orgPolicies, isLoading: isLoadingOrg } = useGetSLAPolicies();

  const [draft, setDraft] = useState<Record<PriorityLevel, PolicyDraft> | null>(null);
  const [editing, setEditing] = useState(false);

  const isLoading = isLoadingProject || isLoadingOrg;

  const buildDraft = (pp: SlaPolicy[]): Record<PriorityLevel, PolicyDraft> => {
    const map = new Map(pp.map((p) => [p.priority as PriorityLevel, p]));
    return Object.fromEntries(
      PRIORITY_LEVELS.map(({ value }) => {
        const p = map.get(value);
        return [value, {
          responseMinutes:   minutesToDisplay(p?.responseMinutes),
          resolutionMinutes: minutesToDisplay(p?.resolutionMinutes),
        }];
      }),
    ) as Record<PriorityLevel, PolicyDraft>;
  };

  const { mutate: upsertPolicies, isPending: isSaving } = useUpsertProjectSLAPolicies({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project SLA overrides saved" });
        refetchProject();
        setEditing(false);
        setDraft(null);
      },
      onError: (err: Error) => {
        toast({ title: "Failed to save overrides", description: err.message, variant: "destructive" });
      },
    },
  });

  function startEditing() {
    setDraft(buildDraft(projectPolicies ?? []));
    setEditing(true);
  }
  function cancelEditing() {
    setDraft(null);
    setEditing(false);
  }
  function handleSave() {
    if (!draft) return;
    const entries = PRIORITY_LEVELS.map(({ value }) => ({
      priority: value as "low" | "medium" | "high" | "critical",
      responseMinutes:   displayToMinutes(draft[value].responseMinutes),
      resolutionMinutes: displayToMinutes(draft[value].resolutionMinutes),
    })).filter((e) => e.responseMinutes != null || e.resolutionMinutes != null);
    upsertPolicies({ projectId, data: { policies: entries } });
  }
  function updateDraft(priority: PriorityLevel, field: keyof PolicyDraft, value: string) {
    setDraft((prev) => prev ? { ...prev, [priority]: { ...prev[priority], [field]: value } } : prev);
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4" />
              SLA Overrides
            </CardTitle>
            <CardDescription className="mt-1">
              Override the org-level SLA targets for tasks in this project.
              Unset priorities fall back to the org default.
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={startEditing}>
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {PRIORITY_LEVELS.map(({ value }) => (
              <div key={value} className="h-10 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : editing && draft ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[120px_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>Priority</span>
              <span>Response (min)</span>
              <span>Resolution (min)</span>
            </div>
            {PRIORITY_LEVELS.map(({ value, label }) => (
              <div key={value} className="grid grid-cols-[120px_1fr_1fr] gap-3 items-center">
                <span className="text-sm font-medium">{label}</span>
                <Input
                  type="number" min={1} placeholder="Org default"
                  value={draft[value].responseMinutes}
                  onChange={(e) => updateDraft(value, "responseMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  type="number" min={1} placeholder="Org default"
                  value={draft[value].resolutionMinutes}
                  onChange={(e) => updateDraft(value, "resolutionMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save overrides"}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[120px_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>Priority</span>
              <span>Response</span>
              <span>Resolution</span>
            </div>
            {PRIORITY_LEVELS.map(({ value, label }) => {
              const proj = projectPolicies?.find((p) => p.priority === value);
              const org  = orgPolicies?.find((p) => p.priority === value);
              const hasProjectOverride = proj && (proj.responseMinutes != null || proj.resolutionMinutes != null);

              const displayVal = (projMin: number | null | undefined, orgMin: number | null | undefined) => {
                if (projMin != null) return <strong className="text-foreground">{projMin}m</strong>;
                if (orgMin != null)  return <span className="text-muted-foreground/60">{orgMin}m (org)</span>;
                return <span className="text-muted-foreground/50">—</span>;
              };

              return (
                <div key={value} className="grid grid-cols-[120px_1fr_1fr] gap-3 items-center py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{label}</span>
                    {hasProjectOverride && (
                      <span className="text-[9px] font-semibold bg-primary/10 text-primary px-1 rounded">override</span>
                    )}
                  </div>
                  <span className="text-sm">{displayVal(proj?.responseMinutes, org?.responseMinutes)}</span>
                  <span className="text-sm">{displayVal(proj?.resolutionMinutes, org?.resolutionMinutes)}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ProjectDetail ────────────────────────────────────────────────────────────

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const projectId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const fromSearch = new URLSearchParams(searchString).get("from") === "search";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useOrgContext();

  const [editOpen, setEditOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

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
      <NewTaskModal open={newTaskOpen} onOpenChange={setNewTaskOpen} initialProjectId={projectId} />
      {/* Header / Nav */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
        {fromSearch && (
          <>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <span>/</span>
          </>
        )}
        <Link href="/projects" className="hover:text-foreground flex items-center gap-1 transition-colors">
          {!fromSearch && <ArrowLeft className="w-4 h-4" />}
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
              <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setEditOpen(true)}>
                <Edit className="w-3.5 h-3.5" /> Edit Project
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete Project" data-testid="btn-delete-project">
                    <Trash2 className="w-4 h-4" />
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
                <span className="text-sm font-medium text-muted-foreground">Project Progress</span>
                <div className="text-2xl font-bold">{progress}%</div>
              </div>
              <div className="text-sm text-muted-foreground mb-1">
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
          
        </CardContent>
      </Card>

      {/* Notes Section */}
      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-6">
          <InlineNotes projectId={projectId} />
        </CardContent>
      </Card>

      {/* SLA Overrides (admin only) */}
      {hasPermission("manage_sla_policies") && (
        <ProjectSlaPoliciesCard projectId={projectId} />
      )}

      {/* Tasks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Project Tasks</h2>
          <Button size="sm" className="gap-2" onClick={() => setNewTaskOpen(true)}>
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
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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