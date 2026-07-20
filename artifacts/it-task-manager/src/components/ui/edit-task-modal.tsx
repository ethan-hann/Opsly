import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
  getGetDashboardSummaryQueryKey,
  TaskInputStatus,
  TaskInputPriority,
  TaskInputCategory,
} from "@workspace/api-client-react";
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
import { Textarea } from "@/components/ui/textarea";
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
  status: TaskInputStatus;
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

const STATUS_OPTIONS: { value: TaskInputStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: { value: TaskInputPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const CATEGORY_OPTIONS: { value: TaskInputCategory; label: string }[] = [
  { value: "incident", label: "Incident" },
  { value: "change", label: "Change" },
  { value: "maintenance", label: "Maintenance" },
  { value: "deployment", label: "Deployment" },
  { value: "support", label: "Support" },
  { value: "other", label: "Other" },
];

export function EditTaskModal({ open, onOpenChange, task }: EditTaskModalProps) {
  const queryClient = useQueryClient();
  const { mutate: updateTask, isPending } = useUpdateTask();
  const { data: projects } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: customFields = [] } = useListCustomFieldDefinitions();

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[]
  );

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [projectId, setProjectId] = useState<string>(
    task.projectId != null ? String(task.projectId) : "none"
  );
  const [status, setStatus] = useState<TaskInputStatus>(task.status);
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
      setStatus(task.status);
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
          toast({ title: "Task updated" });
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update task.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="edit-task-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: "" })); }}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-task-desc">Description</Label>
            <Textarea
              id="edit-task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects?.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskInputStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskInputPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskInputCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Assignee</Label>
              <AssigneeCombobox
                value={assignee}
                onChange={(v) => { setAssignee(v); setErrors(prev => ({ ...prev, assignee: "" })); }}
                error={errors.assignee}
                onErrorChange={(err) => setErrors(prev => ({ ...prev, assignee: err }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-task-due">Due Date</Label>
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
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
