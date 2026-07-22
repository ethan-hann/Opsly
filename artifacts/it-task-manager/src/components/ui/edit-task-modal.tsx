import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  useListWorkflowStages,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
  getGetDashboardSummaryQueryKey,
  TaskInputPriority,
  TaskInputCategory,
} from "@workspace/api-client-react";
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

interface Task {
  id: number;
  title: string;
  description?: string | null;
  projectId?: number | null;
  status: string;
  stageType?: string | null;
  stageName?: string | null;
  priority: TaskInputPriority;
  category: TaskInputCategory;
  assignee?: string | null;
  dueDate?: string | null;
  customFields?: Record<string, unknown>;
}

interface EditTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
}


function getPriorityOptions(t: (k: string) => string): { value: TaskInputPriority; label: string }[] {
  return [
    { value: "low", label: t('tasks.priorityLow') },
    { value: "medium", label: t('tasks.priorityMedium') },
    { value: "high", label: t('tasks.priorityHigh') },
    { value: "critical", label: t('tasks.priorityCritical') },
  ];
}

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

export function EditTaskModal({ open, onOpenChange, task }: EditTaskModalProps) {
  const { tSingular } = useTerminology();
  const { t } = useTranslation();
  const priorityOptions = getPriorityOptions(t);
  const categoryOptions = getCategoryOptions(t);
  const queryClient = useQueryClient();
  const { mutate: updateTask, isPending } = useUpdateTask();
  const { hasPermission } = useOrgContext();
  const canClose = hasPermission('close_tasks');
  const { data: projects } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: customFields = [] } = useListCustomFieldDefinitions();
  const { data: stages = [] } = useListWorkflowStages();
  const activeStages = stages.filter((s) => !s.archivedAt && (canClose || s.type !== 'closed'));

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[]
  );

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [projectId, setProjectId] = useState<string>(
    task.projectId != null ? String(task.projectId) : "none"
  );
  const [status, setStatus] = useState<string>(task.status);
  const [priority, setPriority] = useState<TaskInputPriority>(task.priority);
  const [category, setCategory] = useState<TaskInputCategory>(task.category);
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(
    (task.customFields as Record<string, unknown>) ?? {}
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset to task's current values on close
      setTitle(task.title);
      setDescription(task.description ?? "");
      setProjectId(task.projectId != null ? String(task.projectId) : "none");
      setStatus(task.status as string);
      setPriority(task.priority);
      setCategory(task.category);
      setAssignee(task.assignee ?? "");
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
      setErrors({});
      setCustomFieldValues((task.customFields as Record<string, unknown>) ?? {});
    }
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Task title is required.";
    const assigneeErr = validateAssignee(assignee, memberEmails);
    if (assigneeErr) errs.assignee = assigneeErr;
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    updateTask(
      {
        id: task.id,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          projectId: projectId !== "none" ? Number(projectId) : null,
          customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
          status,
          priority,
          category,
          assignee: assignee.trim() || null,
          dueDate: dueDate || undefined,
        },
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(["getTask", task.id], data);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: t("taskDetail.editTask", { task: tSingular("tasks") }) });
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: t("common.error"), description: t("tasks.failedToUpdate"), variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("taskDetail.editTask", { task: tSingular("tasks") })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="edit-task-title">{t("common.name")} <span className="text-destructive">*</span></Label>
            <Input
              id="edit-task-title"
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
            <Select value={projectId} onValueChange={setProjectId}>
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
              {/* Read-only when task is in a closed stage and user lacks close_tasks */}
              {!canClose && task.stageType === 'closed' ? (
                <div className="h-9 px-3 py-2 text-sm rounded-md border border-input bg-muted text-muted-foreground flex items-center">
                  {task.stageName ?? status}
                </div>
              ) : (
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activeStages.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                    {status && !activeStages.some((s) => String(s.id) === status) && (
                      <SelectItem value={status} className="text-muted-foreground">
                        {stages.find((s) => String(s.id) === status)?.name ?? status} (archived)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label>{t("common.priority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskInputPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {priorityOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("tasks.filterByCategory")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskInputCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map(o => (
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
              <Label htmlFor="edit-task-due">{t("common.dueDate")}</Label>
              <Input
                id="edit-task-due"
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

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
