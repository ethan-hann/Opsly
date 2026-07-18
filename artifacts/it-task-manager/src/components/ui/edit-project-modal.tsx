import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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

const STATUS_OPTIONS: { value: ProjectInputStatus; label: string }[] = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

const PRIORITY_OPTIONS: { value: ProjectInputPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function EditProjectModal({ open, onOpenChange, project }: EditProjectModalProps) {
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
    if (!name.trim()) errs.name = "Project name is required.";
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
          toast({ title: "Project updated" });
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update project.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="edit-proj-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="edit-proj-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-proj-desc">Description</Label>
            <Textarea
              id="edit-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectInputStatus)}>
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
              <Select value={priority} onValueChange={(v) => setPriority(v as ProjectInputPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-proj-due">Due Date</Label>
            <Input
              id="edit-proj-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

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
