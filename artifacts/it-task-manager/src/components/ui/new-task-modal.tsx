import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  useListTaskTemplates,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
  getGetDashboardSummaryQueryKey,
  TaskInputStatus,
  TaskInputPriority,
  TaskInputCategory,
} from "@workspace/api-client-react";
import type { TaskTemplate } from "@workspace/api-client-react";
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
import { AssigneeCombobox, validateAssignee } from "@/components/ui/assignee-combobox";
import { FileText, ChevronDown, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface NewTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: number;
  initialTemplate?: TaskTemplate;
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

// ─── Template picker ──────────────────────────────────────────────────────────

interface TemplatePickerProps {
  templates: TaskTemplate[];
  activeTemplate: TaskTemplate | null;
  onSelect: (t: TaskTemplate) => void;
  onClear: () => void;
}

function TemplatePicker({ templates, activeTemplate, onSelect, onClear }: TemplatePickerProps) {
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
            {activeTemplate ? activeTemplate.name : "Use template"}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        {activeTemplate && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center justify-center w-6 h-7 rounded-r-md border border-l-0 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            aria-label="Clear template"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <PopoverContent className="w-64 p-1" align="start">
          <div className="flex flex-col gap-0.5">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onSelect(t); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs rounded-sm transition-colors ${
                  activeTemplate?.id === t.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <p className="font-medium">{t.name}</p>
                <div className="flex gap-1.5 mt-0.5 opacity-70">
                  <Badge variant="outline" className="text-[10px] py-0 capitalize border-current">
                    {t.defaultPriority}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] py-0 capitalize border-current">
                    {t.defaultCategory}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {!activeTemplate && (
        <span className="text-xs text-muted-foreground">Pre-fill from a saved template</span>
      )}
      {activeTemplate && (
        <span className="text-xs text-muted-foreground">Fields pre-filled — edit freely</span>
      )}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function NewTaskModal({ open, onOpenChange, initialProjectId, initialTemplate }: NewTaskModalProps) {
  const queryClient = useQueryClient();
  const { mutate: createTask, isPending } = useCreateTask();
  const { data: projects } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: templates = [] } = useListTaskTemplates();

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[]
  );

  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(initialTemplate ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(initialProjectId ? String(initialProjectId) : "none");
  const [status, setStatus] = useState<TaskInputStatus>("todo");
  const [priority, setPriority] = useState<TaskInputPriority>("medium");
  const [category, setCategory] = useState<TaskInputCategory>("other");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  const { data: customFields = [] } = useListCustomFieldDefinitions();

  // Sync projectId whenever the modal opens or initialProjectId changes
  useEffect(() => {
    if (open) {
      setProjectId(initialProjectId ? String(initialProjectId) : "none");
    }
  }, [open, initialProjectId]);

  // Apply initialTemplate when modal opens
  useEffect(() => {
    if (open && initialTemplate) {
      applyTemplate(initialTemplate);
    }
  }, [open, initialTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setStatus("todo");
    setPriority("medium");
    setCategory("other");
    setAssignee("");
    setDueDate("");
    setErrors({});
    setCustomFieldValues({});
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Task created", description: `"${title.trim()}" has been created.` });
          resetForm();
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to create task.", variant: "destructive" });
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
          <DialogTitle>New Task</DialogTitle>
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
            <Label htmlFor="task-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="task-title"
              placeholder="e.g. Investigate disk usage on prod-01"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: "" })); }}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              placeholder="Optional details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!!initialProjectId}>
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TaskInputCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Label htmlFor="task-due">Due Date</Label>
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

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
