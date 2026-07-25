import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskInputPriority, TaskInputCategory, WorkflowStage } from "@workspace/api-client-react";

interface TaskFormStatusPriorityProps {
  status: string;
  onStatusChange: (v: string) => void;
  priority: TaskInputPriority;
  onPriorityChange: (v: TaskInputPriority) => void;
  category: TaskInputCategory;
  onCategoryChange: (v: TaskInputCategory) => void;
  stages: WorkflowStage[];
  /** When true, the status select is replaced with a read-only display */
  readOnly?: boolean;
  /** Display name used when status is read-only */
  statusDisplayName?: string;
  /** Include closed stages (for users with close_tasks) */
  includeClosedStages?: boolean;
}

const PRIORITY_OPTIONS: { value: TaskInputPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

function getCategoryOptions(
  t: (k: string) => string,
): { value: TaskInputCategory; label: string }[] {
  return [
    { value: "incident", label: t("tasks.categoryIncident") },
    { value: "change", label: t("tasks.categoryChange") },
    { value: "maintenance", label: t("tasks.categoryMaintenance") },
    { value: "deployment", label: t("tasks.categoryDeployment") },
    { value: "support", label: t("tasks.categorySupport") },
    { value: "other", label: t("tasks.categoryOther") },
  ];
}

export function TaskFormStatusPriority({
  status,
  onStatusChange,
  priority,
  onPriorityChange,
  category,
  onCategoryChange,
  stages,
  readOnly,
  statusDisplayName,
  includeClosedStages = false,
}: TaskFormStatusPriorityProps) {
  const { t } = useTranslation();
  const categoryOptions = getCategoryOptions(t);

  const activeStages = stages.filter(
    (s) => !s.archivedAt && (includeClosedStages || s.type !== "closed"),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>{t("common.status")}</Label>
          {readOnly ? (
            <div className="h-9 px-3 py-2 text-sm rounded-md border border-input bg-muted text-muted-foreground flex items-center">
              {statusDisplayName ?? status}
            </div>
          ) : (
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("taskDetail.selectStage")} />
              </SelectTrigger>
              <SelectContent>
                {activeStages.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
                {status &&
                  !activeStages.some((s) => String(s.id) === status) && (
                    <SelectItem
                      value={status}
                      className="text-muted-foreground"
                    >
                      {stages.find((s) => String(s.id) === status)?.name ??
                        status}{" "}
                      (archived)
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1">
          <Label>{t("common.priority")}</Label>
          <Select
            value={priority}
            onValueChange={(v) => onPriorityChange(v as TaskInputPriority)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("tasks.filterByCategory")}</Label>
          <Select
            value={category}
            onValueChange={(v) => onCategoryChange(v as TaskInputCategory)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
