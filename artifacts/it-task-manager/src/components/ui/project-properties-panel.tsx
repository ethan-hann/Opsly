import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateProject } from "@workspace/api-client-react";
import type { Project, ProjectUpdate } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import {
  PropertyRow,
  GHOST_TRIGGER,
  InlineDueDatePicker,
} from "@/components/ui/property-panel";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Tag, AlertTriangle, CalendarIcon } from "lucide-react";

// ─── ProjectPropertiesPanel ───────────────────────────────────────────────────

interface ProjectPropertiesPanelProps {
  project: Project;
}

export function ProjectPropertiesPanel({ project }: ProjectPropertiesPanelProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = useOrgContext();
  const canEdit = hasPermission("manage_projects");

  const [dueDateOpen, setDueDateOpen] = useState(false);

  const { mutate: updateProject } = useUpdateProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["getProject", project.id] });
      },
      onError: () => {
        toast({
          title: t("projects.failedToUpdate"),
          variant: "destructive",
        });
      },
    },
  });

  function handleChange(data: ProjectUpdate) {
    updateProject({ id: project.id, data });
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("projects.properties")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {/* Status */}
          <PropertyRow
            icon={<Tag className="w-3.5 h-3.5" />}
            label={t("common.status")}
          >
            {canEdit ? (
              <Select
                value={project.status}
                onValueChange={(val) =>
                  handleChange({ status: val as ProjectUpdate["status"] })
                }
              >
                <SelectTrigger
                  className={cn(
                    GHOST_TRIGGER,
                    "border-transparent [&>svg]:hidden",
                  )}
                >
                  <SelectValue>
                    <StatusBadge status={project.status} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">{t("projects.statusPlanning")}</SelectItem>
                  <SelectItem value="active">{t("projects.statusActive")}</SelectItem>
                  <SelectItem value="on_hold">{t("projects.statusOnHold")}</SelectItem>
                  <SelectItem value="completed">{t("projects.statusCompleted")}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <StatusBadge status={project.status} />
            )}
          </PropertyRow>

          {/* Priority */}
          <PropertyRow
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            label={t("common.priority")}
          >
            {canEdit ? (
              <Select
                value={project.priority}
                onValueChange={(val) =>
                  handleChange({ priority: val as ProjectUpdate["priority"] })
                }
              >
                <SelectTrigger
                  className={cn(
                    GHOST_TRIGGER,
                    "border-transparent [&>svg]:hidden",
                  )}
                >
                  <SelectValue>
                    <PriorityBadge priority={project.priority} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("tasks.priorityLow")}</SelectItem>
                  <SelectItem value="medium">{t("tasks.priorityMedium")}</SelectItem>
                  <SelectItem value="high">{t("tasks.priorityHigh")}</SelectItem>
                  <SelectItem value="critical">{t("tasks.priorityCritical")}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <PriorityBadge priority={project.priority} />
            )}
          </PropertyRow>

          {/* Due Date */}
          <PropertyRow
            icon={<CalendarIcon className="w-3.5 h-3.5" />}
            label={t("common.dueDate")}
          >
            {canEdit ? (
              <InlineDueDatePicker
                value={project.dueDate ?? null}
                open={dueDateOpen}
                onOpenChange={setDueDateOpen}
                onChange={(date) => handleChange({ dueDate: date })}
              />
            ) : (
              <span className="text-sm px-2">
                {project.dueDate ? (
                  formatDate(project.dueDate, i18n.language)
                ) : (
                  <span className="text-muted-foreground italic">
                    {t("projects.noDate")}
                  </span>
                )}
              </span>
            )}
          </PropertyRow>
        </div>
      </CardContent>
    </Card>
  );
}
