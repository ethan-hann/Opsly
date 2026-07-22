import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateProject,
  getListProjectsQueryKey,
  ProjectInputStatus,
  ProjectInputPriority,
} from "@workspace/api-client-react";
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

interface Project {
  id: number;
  name: string;
  description?: string | null;
  status: ProjectInputStatus;
  priority: ProjectInputPriority;
  dueDate?: string | null;
}

interface EditProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

function getStatusOptions(t: (k: string) => string): { value: ProjectInputStatus; label: string }[] {
  return [
    { value: "planning", label: t("projects.statusPlanning") },
    { value: "active", label: t("projects.statusActive") },
    { value: "on_hold", label: t("projects.statusOnHold") },
    { value: "completed", label: t("projects.statusCompleted") },
  ];
}

function getPriorityOptions(t: (k: string) => string): { value: ProjectInputPriority; label: string }[] {
  return [
    { value: "low", label: t("tasks.priorityLow") },
    { value: "medium", label: t("tasks.priorityMedium") },
    { value: "high", label: t("tasks.priorityHigh") },
    { value: "critical", label: t("tasks.priorityCritical") },
  ];
}

export function EditProjectModal({ open, onOpenChange, project }: EditProjectModalProps) {
  const { t } = useTranslation();
  const { tSingular } = useTerminology();
  const queryClient = useQueryClient();
  const { mutate: updateProject, isPending } = useUpdateProject();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectInputStatus>(project.status);
  const [priority, setPriority] = useState<ProjectInputPriority>(project.priority);
  const [dueDate, setDueDate] = useState(project.dueDate ? project.dueDate.slice(0, 10) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName(project.name);
      setDescription(project.description ?? "");
      setStatus(project.status);
      setPriority(project.priority);
      setDueDate(project.dueDate ? project.dueDate.slice(0, 10) : "");
      setErrors({});
    }
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("projects.nameRequired");
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    updateProject(
      {
        id: project.id,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          dueDate: dueDate || undefined,
        },
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(["getProject", project.id], data);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: t("projects.updated") });
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: t("common.error"), description: t("projects.failedToUpdate"), variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("common.edit")} {tSingular("projects")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="edit-proj-name">{t("common.name")} <span className="text-destructive">*</span></Label>
            <Input
              id="edit-proj-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <Label>{t("common.description")}</Label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder={t("projects.descriptionPlaceholder")}
              className="h-48 border border-input rounded-md overflow-hidden"
              previewMode="edit"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("common.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectInputStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getStatusOptions(t).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("common.priority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ProjectInputPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getPriorityOptions(t).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-proj-due">{t("common.dueDate")}</Label>
            <Input
              id="edit-proj-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("common.saving") : t("projects.saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
