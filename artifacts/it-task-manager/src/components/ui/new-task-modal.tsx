import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  useListTaskTemplates,
  useListWorkflowStages,
  useListTasks,
  useCreateTaskDependency,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
  getGetDashboardSummaryQueryKey,
  TaskInputPriority,
  TaskInputCategory,
} from "@workspace/api-client-react";
import type { TaskTemplate } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import { CustomFieldInputs } from "@/components/ui/custom-field-inputs";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { validateAssignee } from "@/lib/validate-assignee";
import { FileText, ChevronDown, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface NewTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: number;
  initialTemplate?: TaskTemplate;
}


const PRIORITY_OPTIONS: { value: TaskInputPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

function getCategoryOptions(t: (k: string) => string): { value: TaskInputCategory; label: string }[] {
  return [
    { value: "incident", label: t('tasks.categoryIncident') },
    { value: "change", label: t('tasks.categoryChange') },
    { value: "maintenance", label: t('tasks.categoryMaintenance') },
    { value: "deployment", label: t('tasks.categoryDeployment') },
    { value: "support", label: t('tasks.categorySupport') },
    { value: "other", label: t('tasks.categoryOther') },
  ];
}

// ─── Template picker ──────────────────────────────────────────────────────────

interface TemplatePickerProps {
  templates: TaskTemplate[];
  activeTemplate: TaskTemplate | null;
  onSelect: (t: TaskTemplate) => void;
  onClear: () => void;
}

function TemplatePicker({ templates, activeTemplate, onSelect, onClear }: TemplatePickerProps) {
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);

  if (templates.length === 0) return null;

  return (
    <div className="flex items-center gap-2 py-1 border-b border-border pb-3 mb-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-3 h-7 text-xs rounded-l-md font-medium border transition-colors ${
              activeTemplate
                ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/15"
                : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted"
            }`}
          >
            <FileText className="w-3 h-3" />
            {activeTemplate ? activeTemplate.name : tr('tasks.useTemplate')}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        {activeTemplate && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center justify-center w-6 h-7 rounded-r-md border border-l-0 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            aria-label={tr('tasks.clearTemplate')}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <PopoverContent className="w-64 p-1" align="start">
          <div className="flex flex-col gap-0.5">
            {templates.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => { onSelect(tmpl); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs rounded-sm transition-colors ${
                  activeTemplate?.id === tmpl.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <p className="font-medium">{tmpl.name}</p>
                <div className="flex gap-1.5 mt-0.5 opacity-70">
                  <Badge variant="outline" className="text-[10px] py-0 capitalize border-current">
                    {tmpl.defaultPriority}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] py-0 capitalize border-current">
                    {tmpl.defaultCategory}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {!activeTemplate && (
        <span className="text-xs text-muted-foreground">{tr('tasks.preFillFromTemplate')}</span>
      )}
      {activeTemplate && (
        <span className="text-xs text-muted-foreground">{tr('tasks.fieldsPreFilled')}</span>
      )}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function NewTaskModal({ open, onOpenChange, initialProjectId, initialTemplate }: NewTaskModalProps) {
  const { tSingular } = useTerminology();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutate: createTask, isPending } = useCreateTask();
  const { data: projects } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: templates = [] } = useListTaskTemplates();
  const { data: stages = [] } = useListWorkflowStages();
  const activeStages = stages.filter((s) => !s.archivedAt);
  const { isFeatureEnabled, hasPermission } = useOrgContext();
  const canLinkTasks = isFeatureEnabled("task_trees") && hasPermission("link_tasks");
  const { mutate: createDep } = useCreateTaskDependency();

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[]
  );

  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(initialTemplate ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(initialProjectId ? String(initialProjectId) : "none");
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<TaskInputPriority>("medium");
  const [category, setCategory] = useState<TaskInputCategory>("other");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [selectedParentIds, setSelectedParentIds] = useState<number[]>([]);
  const [depSearch, setDepSearch] = useState("");
  const [depOpen, setDepOpen] = useState(false);

  // Fetch tasks in selected project for dependency picker
  const numericProjectId = projectId !== "none" ? Number(projectId) : undefined;
  const depParams = numericProjectId ? { projectId: numericProjectId } : undefined;
  const { data: projectTasks = [] } = useListTasks(
    depParams,
    { query: { enabled: canLinkTasks && !!numericProjectId, queryKey: getListTasksQueryKey(depParams) } },
  );

  const { data: customFields = [] } = useListCustomFieldDefinitions();

  // Sync projectId whenever the modal opens or initialProjectId changes
  useEffect(() => {
    if (open) {
      setProjectId(initialProjectId ? String(initialProjectId) : "none");
    }
  }, [open, initialProjectId]);

  // Default status to first active stage when stages load and status is not yet set
  useEffect(() => {
    if (activeStages.length > 0 && !status) {
      setStatus(String(activeStages[0].id));
    }
  }, [activeStages, status]);

  // Apply initialTemplate when modal opens
  useEffect(() => {
    if (open && initialTemplate) {
      applyTemplate(initialTemplate);
    }
  }, [open, initialTemplate]); // intentional: applyTemplate is stable; re-running on its ref change would cause duplicate application

  function applyTemplate(t: TaskTemplate) {
    setAppliedTemplate(t);
    if (t.defaultTitle) setTitle(t.defaultTitle);
    setPriority(t.defaultPriority as TaskInputPriority);
    setCategory(t.defaultCategory as TaskInputCategory);
    if (t.defaultDescription) setDescription(t.defaultDescription);
  }

  function clearTemplate() {
    setAppliedTemplate(null);
  }

  const resetForm = () => {
    setAppliedTemplate(null);
    setTitle("");
    setDescription("");
    setProjectId(initialProjectId ? String(initialProjectId) : "none");
    setStatus(activeStages.length > 0 ? String(activeStages[0].id) : "");
    setPriority("medium");
    setCategory("other");
    setAssignee("");
    setDueDate("");
    setErrors({});
    setCustomFieldValues({});
    setSelectedParentIds([]);
    setDepSearch("");
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Task title is required.";
    const assigneeErr = validateAssignee(assignee, memberEmails);
    if (assigneeErr) errs.assignee = assigneeErr;
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    createTask(
      {
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          projectId: projectId !== "none" ? Number(projectId) : undefined,
          status,
          priority,
          category,
          assignee: assignee.trim() || undefined,
          dueDate: dueDate || undefined,
          customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
        },
      },
      {
        onSuccess: (newTask) => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          // Link selected parent dependencies
          for (const parentId of selectedParentIds) {
            createDep({ data: { taskId: newTask.id, dependsOnTaskId: parentId } });
          }
          toast({ title: t("tasks.newTask", { task: tSingular("tasks") }), description: t("tasks.createdSuccess", { title: title.trim() }) });
          resetForm();
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: t("common.error"), description: t("tasks.failedToCreate"), variant: "destructive" });
        },
      }
    );
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("tasks.newTask", { task: tSingular("tasks") })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Template picker */}
          <TemplatePicker
            templates={templates}
            activeTemplate={appliedTemplate}
            onSelect={applyTemplate}
            onClear={clearTemplate}
          />

          <div className="space-y-1">
            <Label htmlFor="task-title">{t("common.name")} <span className="text-destructive">*</span></Label>
            <Input
              id="task-title"
              placeholder={t("tasks.titlePlaceholder")}
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: "" })); }}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1">
            <Label>{t("common.description")}</Label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder={t("tasks.descriptionPlaceholder")}
              className="h-48 border border-input rounded-md overflow-hidden"
              members={members}
            />
          </div>

          <div className="space-y-1">
            <Label>{t("tasks.filterByProject")}</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!!initialProjectId}>
              <SelectTrigger>
                <SelectValue placeholder={t("taskDetail.noProject")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("taskDetail.noProject")}</SelectItem>
                {projects?.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>{t("common.status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder={t("taskDetail.selectStage")} />
                </SelectTrigger>
                <SelectContent>
                  {activeStages.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("common.priority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskInputPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("tasks.filterByCategory")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskInputCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getCategoryOptions(t).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("common.assignee")}</Label>
              <AssigneeCombobox
                value={assignee}
                onChange={(v) => { setAssignee(v); setErrors(prev => ({ ...prev, assignee: "" })); }}
                error={errors.assignee}
                onErrorChange={(err) => setErrors(prev => ({ ...prev, assignee: err }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-due">{t("common.dueDate")}</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <CustomFieldInputs
            fields={customFields}
            values={customFieldValues}
            onChange={(id, value) => setCustomFieldValues(prev => ({ ...prev, [id]: value }))}
          />

          {/* Dependency picker — shown when task_trees is enabled and user can link */}
          {canLinkTasks && (
            <div className="space-y-1">
              <Label>Depends on (parent {tSingular("tasks").toLowerCase()})</Label>
              {!numericProjectId ? (
                <div className="w-full h-9 px-3 py-2 text-sm text-left border border-input rounded-md bg-muted/30 text-muted-foreground italic flex items-center">
                  Select a project above to add dependencies
                </div>
              ) : (
                <Popover open={depOpen} onOpenChange={setDepOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full h-9 px-3 py-2 text-sm text-left border border-input rounded-md bg-background hover:bg-muted/40 flex items-center gap-2"
                    >
                      {selectedParentIds.length > 0 ? (
                        <span className="flex gap-1 flex-wrap">
                          {selectedParentIds.map((id) => {
                            const t2 = projectTasks.find((t) => t.id === id);
                            return (
                              <Badge key={id} variant="secondary" className="text-xs">
                                TSK-{t2?.orgTaskNumber ?? id}
                                <button
                                  type="button"
                                  className="ml-1 hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedParentIds((prev) => prev.filter((pid) => pid !== id));
                                  }}
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </Badge>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">No dependencies</span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <div className="p-2 border-b">
                      <input
                        className="w-full text-sm px-2 py-1 bg-transparent outline-none"
                        placeholder="Search tasks…"
                        value={depSearch}
                        onChange={(e) => setDepSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {projectTasks
                        .filter(
                          (t) =>
                            t.stageType !== "closed" &&
                            (depSearch === "" ||
                              t.title.toLowerCase().includes(depSearch.toLowerCase()) ||
                              String(t.orgTaskNumber).includes(depSearch)),
                        )
                        .map((t) => {
                          const selected = selectedParentIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}
                              onClick={() => {
                                setSelectedParentIds((prev) =>
                                  selected ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                                );
                              }}
                            >
                              <span className="font-mono text-xs text-muted-foreground">TSK-{t.orgTaskNumber}</span>
                              <span className="truncate">{t.title}</span>
                              {selected && <span className="ml-auto text-primary text-xs">✓</span>}
                            </button>
                          );
                        })}
                      {projectTasks.filter((t) => t.stageType !== "closed").length === 0 && (
                        <p className="px-3 py-2 text-sm text-muted-foreground italic">No open tasks in this project.</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("common.saving") : t("tasks.createTask", { task: tSingular("tasks") })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
