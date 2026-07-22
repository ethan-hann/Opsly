import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearch } from "wouter";
import { useTerminology } from "@/context/terminology-context";
import {
  useGetProject, useListTasks, useDeleteProject, getListProjectsQueryKey,
  useGetProjectSLAPolicies, useUpsertProjectSLAPolicies, useGetSLAPolicies,
  useListWorkflowStages,
} from "@workspace/api-client-react";
import type { SlaPolicy } from "@workspace/api-client-react";
import { ProjectPropertiesPanel } from "@/components/ui/project-properties-panel";
import { EditProjectModal } from "@/components/ui/edit-project-modal";
import { NewTaskModal } from "@/components/ui/new-task-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeAgo } from "@/lib/utils";
import { ArrowLeft, Calendar, Pencil, Timer, Trash2, Edit, Plus, CheckSquare, Clock, RotateCcw, History, ChevronDown, ChevronUp, LayoutList, Columns, LayoutPanelTop } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InlineNotes } from "@/components/notes/inline-notes";
import { MarkdownPreview } from "@/components/notes/markdown-preview";
import { KanbanBoard } from "@/components/ui/kanban-board";
import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

// ─── SLA policy helpers ───────────────────────────────────────────────────────

interface SlaAuditEntry {
  id: number;
  projectId: number;
  actorId: string | null;
  actorName: string | null;
  previousPolicies: Array<{ priority: string; responseMinutes: number | null; resolutionMinutes: number | null; warningThresholdPercent: number | null }>;
  newPolicies: Array<{ priority: string; responseMinutes: number | null; resolutionMinutes: number | null; warningThresholdPercent: number | null }>;
  createdAt: string;
}

function useSlaAuditHistory(projectId: number) {
  return useQuery<SlaAuditEntry[]>({
    queryKey: ["project-sla-audit", projectId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/projects/${projectId}/sla-policy-audit`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SLA change history");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

type AuditPolicy = SlaAuditEntry["newPolicies"][number];

function auditActionLabel(prev: AuditPolicy[], next: AuditPolicy[]): { label: string; variant: "default" | "secondary" | "outline" } {
  if (next.length === 0) return { label: "Cleared", variant: "outline" };
  if (prev.length === 0) return { label: "Set", variant: "default" };
  return { label: "Updated", variant: "secondary" };
}

function formatPolicyLine(p: AuditPolicy): string {
  const parts: string[] = [];
  if (p.responseMinutes != null) parts.push(`${p.responseMinutes}m resp`);
  if (p.resolutionMinutes != null) parts.push(`${p.resolutionMinutes}m res`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

const PRIORITY_LEVELS = [
  { value: "critical" as const },
  { value: "high"     as const },
  { value: "medium"   as const },
  { value: "low"      as const },
];

type PriorityLevel = typeof PRIORITY_LEVELS[number]["value"];

function getPriorityLabel(t: (k: string) => string, value: string): string {
  const map: Record<string, string> = {
    critical: t('tasks.priorityCritical'),
    high: t('tasks.priorityHigh'),
    medium: t('tasks.priorityMedium'),
    low: t('tasks.priorityLow'),
  };
  return map[value] ?? value;
}

interface PolicyDraft {
  responseMinutes: string;
  resolutionMinutes: string;
  warningThresholdPercent: string; // 1–99, empty means use server default (80)
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
  const { t, i18n } = useTranslation();
  const { hasPermission } = useOrgContext();
  const canManagePolicies = hasPermission("manage_sla_policies");
  const canViewHistory = hasPermission("view_audit_log") || canManagePolicies;

  const { data: projectPolicies, isLoading: isLoadingProject, refetch: refetchProject } =
    useGetProjectSLAPolicies(projectId);
  const { data: orgPolicies, isLoading: isLoadingOrg } = useGetSLAPolicies();

  const [draft, setDraft] = useState<Record<PriorityLevel, PolicyDraft> | null>(null);
  const [editing, setEditing] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: auditHistory, isLoading: isLoadingHistory } = useSlaAuditHistory(projectId);

  const isLoading = isLoadingProject || isLoadingOrg;

  const buildDraft = (pp: SlaPolicy[]): Record<PriorityLevel, PolicyDraft> => {
    const map = new Map(pp.map((p) => [p.priority as PriorityLevel, p]));
    return Object.fromEntries(
      PRIORITY_LEVELS.map(({ value }) => {
        const p = map.get(value);
        return [value, {
          responseMinutes:         minutesToDisplay(p?.responseMinutes),
          resolutionMinutes:       minutesToDisplay(p?.resolutionMinutes),
          warningThresholdPercent: p?.warningThresholdPercent != null ? String(p.warningThresholdPercent) : "",
        }];
      }),
    ) as Record<PriorityLevel, PolicyDraft>;
  };

  const { mutate: upsertPolicies, isPending: isSaving } = useUpsertProjectSLAPolicies({
    mutation: {
      onSuccess: () => {
        toast({ title: isReverting ? t('projects.revertedToOrgDefaults', 'Reverted to org defaults') : t('projects.slaOverridesSaved', 'Project SLA overrides saved') });
        refetchProject();
        setEditing(false);
        setDraft(null);
        setIsReverting(false);
      },
      onError: (err: Error) => {
        toast({ title: t('projects.slaOverridesFailed', 'Failed to save overrides'), description: err.message, variant: "destructive" });
        setIsReverting(false);
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
    const entries = PRIORITY_LEVELS.map(({ value }) => {
      const w = parseInt(draft[value].warningThresholdPercent, 10);
      return {
        priority: value as "low" | "medium" | "high" | "critical",
        responseMinutes:   displayToMinutes(draft[value].responseMinutes),
        resolutionMinutes: displayToMinutes(draft[value].resolutionMinutes),
        ...(w >= 1 && w <= 99 ? { warningThresholdPercent: w } : {}),
      };
    }).filter((e) => e.responseMinutes != null || e.resolutionMinutes != null);
    upsertPolicies({ projectId, data: { policies: entries } });
  }
  function updateDraft(priority: PriorityLevel, field: keyof PolicyDraft, value: string) {
    setDraft((prev) => prev ? { ...prev, [priority]: { ...prev[priority], [field]: value } } : prev);
  }

  const hasAnyOverride = (projectPolicies ?? []).some(
    (p) => p.responseMinutes != null || p.resolutionMinutes != null,
  );

  function handleRevertToDefaults() {
    setIsReverting(true);
    upsertPolicies({ projectId, data: { policies: [] } });
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4" />
              {t('projects.slaOverrides', 'SLA Overrides')}
            </CardTitle>
            <CardDescription className="mt-1">
              {t('projects.slaOverridesDesc', 'Override the org-level SLA targets for tasks in this project. Unset priorities fall back to the org default.')}
            </CardDescription>
          </div>
          {canManagePolicies && !editing && (
            <div className="flex items-center gap-2 shrink-0">
              {hasAnyOverride && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/50" disabled={isSaving}>
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t('projects.revertToOrgDefaults', 'Revert to org defaults')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('projects.revertToOrgDefaultsConfirm', 'Revert to org defaults?')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('projects.revertToOrgDefaultsDesc', 'This will clear all project-level SLA overrides. Tasks in this project will fall back to the org-wide SLA targets. This cannot be undone automatically.')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRevertToDefaults}>
                        {t('projects.revertToOrgDefaults', 'Revert to org defaults')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={startEditing}>
                <Pencil className="w-3.5 h-3.5" />
                {t('common.edit')}
              </Button>
            </div>
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
            <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>{t('common.priority')}</span>
              <span>{t('projects.responseMin', 'Response (min)')}</span>
              <span>{t('projects.resolutionMin', 'Resolution (min)')}</span>
              <span>{t('projects.warningAt', 'Warning at (%)')}</span>
            </div>
            {PRIORITY_LEVELS.map(({ value }) => (
              <div key={value} className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 items-center">
                <span className="text-sm font-medium">{getPriorityLabel(t, value)}</span>
                <Input
                  type="number" min={1} placeholder={t('projects.orgDefault')}
                  value={draft[value].responseMinutes}
                  onChange={(e) => updateDraft(value, "responseMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  type="number" min={1} placeholder={t('projects.orgDefault')}
                  value={draft[value].resolutionMinutes}
                  onChange={(e) => updateDraft(value, "resolutionMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  type="number" min={1} max={99} placeholder="80"
                  value={draft[value].warningThresholdPercent}
                  onChange={(e) => updateDraft(value, "warningThresholdPercent", e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('common.saving') : t('projects.saveOverrides', 'Save overrides')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>{t('common.priority')}</span>
              <span>{t('projects.response', 'Response')}</span>
              <span>{t('projects.resolution', 'Resolution')}</span>
              <span>{t('projects.warningAtShort', 'Warning at')}</span>
            </div>
            {PRIORITY_LEVELS.map(({ value }) => {
              const proj = projectPolicies?.find((p) => p.priority === value);
              const org  = orgPolicies?.find((p) => p.priority === value);
              const hasProjectOverride = proj && (proj.responseMinutes != null || proj.resolutionMinutes != null);

              const displayVal = (projMin: number | null | undefined, orgMin: number | null | undefined) => {
                if (projMin != null) return <strong className="text-foreground">{projMin}m</strong>;
                if (orgMin != null)  return <span className="text-muted-foreground/60">{orgMin}m (org)</span>;
                return <span className="text-muted-foreground/50">—</span>;
              };

              const displayWarning = () => {
                if (proj?.warningThresholdPercent != null) return <strong className="text-foreground">{proj.warningThresholdPercent}%</strong>;
                if (org?.warningThresholdPercent != null)  return <span className="text-muted-foreground/60">{org.warningThresholdPercent}% (org)</span>;
                return <span className="text-muted-foreground/60">{t('projects.warningDefault')}</span>;
              };

              return (
                <div key={value} className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 items-center py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{getPriorityLabel(t, value)}</span>
                    {hasProjectOverride && (
                      <span className="text-[9px] font-semibold bg-primary/10 text-primary px-1 rounded">{t('projects.overrideBadge')}</span>
                    )}
                  </div>
                  <span className="text-sm">{displayVal(proj?.responseMinutes, org?.responseMinutes)}</span>
                  <span className="text-sm">{displayVal(proj?.resolutionMinutes, org?.resolutionMinutes)}</span>
                  <span className="text-sm">{displayWarning()}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* SLA change history — visible to manage_sla_policies or view_audit_log */}
      {canViewHistory && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <History className="w-4 h-4" />
              {t('projects.changeHistory', 'Change history')}
              {auditHistory && auditHistory.length > 0 && (
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{auditHistory.length}</span>
              )}
            </span>
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showHistory && (
            <div className="px-6 pb-4">
              {isLoadingHistory ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  {t('projects.loadingHistory', 'Loading history…')}
                </div>
              ) : !auditHistory || auditHistory.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{t('projects.noChangesRecorded', 'No changes recorded yet.')}</p>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{t('projects.when', 'When')}</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t('projects.by', 'By')}</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t('common.action')}</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t('projects.newPolicyValues', 'New policy values')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {auditHistory.map((entry) => {
                        const { label, variant } = auditActionLabel(entry.previousPolicies, entry.newPolicies);
                        return (
                          <tr key={entry.id} className="text-xs align-top">
                            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap font-mono">
                              {new Date(entry.createdAt).toLocaleString(i18n.language || undefined)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="bg-muted px-1.5 py-0.5 rounded text-xs">
                                {entry.actorName ?? entry.actorId ?? "System"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge variant={variant} className="text-xs">{label}</Badge>
                            </td>
                            <td className="px-3 py-2.5">
                              {entry.newPolicies.length === 0 ? (
                                <span className="text-muted-foreground italic">{t('projects.revertedToOrgDefaults', 'Reverted to org defaults')}</span>
                              ) : (
                                <div className="space-y-0.5">
                                  {entry.newPolicies.map((p) => (
                                    <div key={p.priority} className="flex items-baseline gap-1.5">
                                      <span className="font-medium text-foreground w-14 shrink-0">
                                        {getPriorityLabel(t, p.priority)}:
                                      </span>
                                      <span className="text-muted-foreground">{formatPolicyLine(p)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
  const canManageProjects = hasPermission('manage_projects');
  const { t: term, tSingular } = useTerminology();
  const { t, i18n } = useTranslation();

  const [editOpen, setEditOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "board">(
    () => (localStorage.getItem("project-detail-view-mode") as "list" | "board") ?? "list",
  );
  const [layoutMode, setLayoutMode] = useState<"stacked" | "tabbed">(
    () => (localStorage.getItem("project-detail-layout-mode") as "stacked" | "tabbed") ?? "stacked",
  );
  const [activeTab, setActiveTab] = useState("tasks");

  useEffect(() => {
    localStorage.setItem("project-detail-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("project-detail-layout-mode", layoutMode);
    if (layoutMode === "tabbed") setActiveTab("tasks");
  }, [layoutMode]);

  const { data: project, isLoading: isLoadingProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: ["getProject", projectId] }
  });
  
  const { data: tasks, isLoading: isLoadingTasks } = useListTasks({ projectId }, {
    query: { enabled: !!projectId, queryKey: ["listTasks", { projectId }] }
  });

  const { data: stages = [] } = useListWorkflowStages();

  const deleteMutation = useDeleteProject({
    mutation: {
      onSuccess: () => {
        toast({ title: t('projects.deleteProjectSuccess', 'Project deleted successfully') });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setLocation("/projects");
      },
      onError: () => {
        toast({ title: t('projects.deleteProjectFailed', 'Failed to delete project'), variant: "destructive" });
      }
    }
  });

  if (isLoadingProject) {
    return <div className="space-y-6 max-w-5xl mx-auto p-4"><Skeleton className="h-40 w-full" /></div>;
  }

  if (!project) {
    return <div className="text-center py-12">{t('projects.notFound', '{{project}} not found', { project: tSingular("projects") })}</div>;
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
              onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/projects")}
              className="hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </button>
            <span>/</span>
          </>
        )}
        <Link href="/projects" className="hover:text-foreground flex items-center gap-1 transition-colors">
          {!fromSearch && <ArrowLeft className="w-4 h-4" />}
          {term("projects")}
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
                  {t('common.dueDate')}: {project.dueDate ? formatDate(project.dueDate, i18n.language) : t('projects.noDate', 'No date')}
                </div>
                <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <Clock className="w-3.5 h-3.5" />
                  {t('common.updated')}: {formatTimeAgo(project.updatedAt, i18n.language)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={project.status} className="text-sm px-3 py-1" />
              <PriorityBadge priority={project.priority} className="text-sm px-3 py-1" />
              {/* Layout mode toggle */}
              <Button
                variant={layoutMode === "stacked" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setLayoutMode("stacked")}
                title={t('projects.stackedLayout', 'Stacked layout')}
              >
                <LayoutList className="w-4 h-4" />
              </Button>
              <Button
                variant={layoutMode === "tabbed" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setLayoutMode("tabbed")}
                title={t('projects.tabbedLayout', 'Tabbed layout')}
              >
                <LayoutPanelTop className="w-4 h-4" />
              </Button>
              {canManageProjects && (
                <>
                  <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setEditOpen(true)}>
                    <Edit className="w-3.5 h-3.5" /> {t('projects.editProject', { defaultValue: 'Edit {{project}}', project: tSingular("projects") })}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" title={t('projects.deleteProject', { defaultValue: 'Delete {{project}}', project: tSingular("projects") })} data-testid="btn-delete-project">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('projects.deleteProjectConfirm')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('projects.deleteProjectDesc', { defaultValue: 'This will permanently delete the {{project}} and all associated data.', project: tSingular("projects").toLowerCase() })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate({ id: project.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleteMutation.isPending ? t('common.deleting') : t('projects.deleteProject', { defaultValue: 'Delete {{project}}', project: tSingular("projects") })}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {project.description && (
            <MarkdownPreview content={project.description} className="px-0 py-0" />
          )}
        </CardContent>
      </Card>

      {/* ── Progress bar + Properties panel (side-by-side on lg+) ────────────── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Progress bar */}
        <div className="flex-1 min-w-0 bg-card border border-border/50 rounded-lg p-4">
          <div className="flex justify-between items-end mb-2">
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground">{t('projects.progress', { defaultValue: '{{project}} Progress', project: tSingular("projects") })}</span>
              <div className="text-2xl font-bold">{progress}%</div>
            </div>
            <div className="text-sm text-muted-foreground mb-1">
              {t('projects.completedCount', { completed: project.completedTaskCount || 0, total: project.taskCount || 0 })} {term("tasks")} {t('projects.completedLabel', 'Completed')}
            </div>
          </div>
          <div className="h-2.5 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* ── Properties panel (right of progress bar on lg+, stacked on mobile) ── */}
        <aside className="w-full lg:w-72 shrink-0">
          <ProjectPropertiesPanel project={project} />
        </aside>
      </div>

      {/* ── Full-width content area ───────────────────────────────────────────── */}
      <div className="space-y-6">

          {/* ── Tabbed layout ─────────────────────────────────────────────────── */}
          {layoutMode === "tabbed" ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="notes">{t('notes.title', 'Notes')}</TabsTrigger>
                {(hasPermission("manage_sla_policies") || hasPermission("view_audit_log")) && (
                  <TabsTrigger value="sla">{t('projects.slaPolicies', 'SLA Policies')}</TabsTrigger>
                )}
                <TabsTrigger value="tasks">{tSingular("projects")} {term("tasks")}</TabsTrigger>
              </TabsList>

              <TabsContent value="notes">
                <Card className="border-border/60 shadow-sm">
                  <CardContent className="pt-6">
                    <InlineNotes projectId={projectId} />
                  </CardContent>
                </Card>
              </TabsContent>

              {(hasPermission("manage_sla_policies") || hasPermission("view_audit_log")) && (
                <TabsContent value="sla">
                  <ProjectSlaPoliciesCard projectId={projectId} />
                </TabsContent>
              )}

              <TabsContent value="tasks">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-tight">{tSingular("projects")} {term("tasks")}</h2>
                    <div className="flex items-center gap-2">
                      <Button
                        data-testid="view-toggle-list"
                        variant={viewMode === "list" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewMode("list")}
                        title={t('tasks.listView')}
                      >
                        <LayoutList className="w-4 h-4" />
                      </Button>
                      <Button
                        data-testid="view-toggle-board"
                        variant={viewMode === "board" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewMode("board")}
                        title={t('tasks.kanbanView')}
                      >
                        <Columns className="w-4 h-4" />
                      </Button>
                      <Button size="sm" className="gap-2" onClick={() => setNewTaskOpen(true)}>
                        <Plus className="w-4 h-4" /> {t('tasks.newTask', { task: tSingular("tasks") })}
                      </Button>
                    </div>
                  </div>

                  {isLoadingTasks ? (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </CardContent>
                    </Card>
                  ) : viewMode === "board" ? (
                    <KanbanBoard tasks={tasks ?? []} stages={stages} />
                  ) : (
                    <Card>
                      <CardContent className="p-0">
                        {tasks && tasks.length > 0 ? (
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
                                  <StatusBadge
                                    status={task.status}
                                    stageName={task.stageName}
                                    stageColor={task.stageColor}
                                    stageArchived={task.stageArchived}
                                  />
                                  <PriorityBadge priority={task.priority} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 text-muted-foreground">
                            <CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>{t('tasks.noTasks', { tasks: term("tasks") })} {t('projects.forThisProject', { defaultValue: 'found for this {{project}}.', project: tSingular("projects").toLowerCase() })}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            /* ── Stacked layout (default) ───────────────────────────────────── */
            <>
              {/* Notes Section */}
              <Card className="border-border/60 shadow-sm">
                <CardContent className="pt-6">
                  <InlineNotes projectId={projectId} />
                </CardContent>
              </Card>

              {/* SLA Overrides — visible to manage_sla_policies and view_audit_log */}
              {(hasPermission("manage_sla_policies") || hasPermission("view_audit_log")) && (
                <ProjectSlaPoliciesCard projectId={projectId} />
              )}

              {/* Tasks Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">{tSingular("projects")} {term("tasks")}</h2>
                  <div className="flex items-center gap-2">
                    <Button
                      data-testid="view-toggle-list"
                      variant={viewMode === "list" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode("list")}
                      title={t('tasks.listView')}
                    >
                      <LayoutList className="w-4 h-4" />
                    </Button>
                    <Button
                      data-testid="view-toggle-board"
                      variant={viewMode === "board" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode("board")}
                      title={t('tasks.kanbanView')}
                    >
                      <Columns className="w-4 h-4" />
                    </Button>
                    <Button size="sm" className="gap-2" onClick={() => setNewTaskOpen(true)}>
                      <Plus className="w-4 h-4" /> {t('tasks.newTask', { task: tSingular("tasks") })}
                    </Button>
                  </div>
                </div>

                {isLoadingTasks ? (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </CardContent>
                  </Card>
                ) : viewMode === "board" ? (
                  <KanbanBoard tasks={tasks ?? []} stages={stages} />
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      {tasks && tasks.length > 0 ? (
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
                                <StatusBadge
                                  status={task.status}
                                  stageName={task.stageName}
                                  stageColor={task.stageColor}
                                  stageArchived={task.stageArchived}
                                />
                                <PriorityBadge priority={task.priority} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                          <p>{t('tasks.noTasks', { tasks: term("tasks") })} {t('projects.forThisProject', { defaultValue: 'found for this {{project}}.', project: tSingular("projects").toLowerCase() })}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
      </div>
    </div>
  );
}