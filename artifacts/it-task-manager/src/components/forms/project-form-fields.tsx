import { useTranslation } from "react-i18next";
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
import type { ProjectInputStatus, ProjectInputPriority, OrgMemberInfo } from "@workspace/api-client-react";

interface ProjectFormFieldsProps {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  status: ProjectInputStatus;
  onStatusChange: (v: ProjectInputStatus) => void;
  priority: ProjectInputPriority;
  onPriorityChange: (v: ProjectInputPriority) => void;
  dueDate: string;
  onDueDateChange: (v: string) => void;
  nameError?: string;
  onNameErrorChange?: (e: string) => void;
  members: OrgMemberInfo[];
}

function getStatusOptions(
  t: (k: string) => string,
): { value: ProjectInputStatus; label: string }[] {
  return [
    { value: "planning", label: t("projects.statusPlanning") },
    { value: "active", label: t("projects.statusActive") },
    { value: "on_hold", label: t("projects.statusOnHold") },
    { value: "completed", label: t("projects.statusCompleted") },
  ];
}

function getPriorityOptions(
  t: (k: string) => string,
): { value: ProjectInputPriority; label: string }[] {
  return [
    { value: "low", label: t("tasks.priorityLow") },
    { value: "medium", label: t("tasks.priorityMedium") },
    { value: "high", label: t("tasks.priorityHigh") },
    { value: "critical", label: t("tasks.priorityCritical") },
  ];
}

export function ProjectFormBasicInfo({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  nameError,
  onNameErrorChange,
  members,
}: Pick<
  ProjectFormFieldsProps,
  | "name"
  | "onNameChange"
  | "description"
  | "onDescriptionChange"
  | "nameError"
  | "onNameErrorChange"
  | "members"
>) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="proj-name">
          {t("common.name")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="proj-name"
          placeholder="e.g. Network Upgrade Q3"
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
            onNameErrorChange?.("");
          }}
        />
        {nameError && (
          <p className="text-xs text-destructive">{nameError}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>{t("common.description")}</Label>
        <MarkdownEditor
          value={description}
          onChange={onDescriptionChange}
          placeholder={t("projects.descriptionPlaceholder")}
          className="h-48 border border-input rounded-md overflow-hidden"
          previewMode="edit"
          members={members}
        />
      </div>
    </div>
  );
}

export function ProjectFormStatusPriority({
  status,
  onStatusChange,
  priority,
  onPriorityChange,
}: Pick<
  ProjectFormFieldsProps,
  "status" | "onStatusChange" | "priority" | "onPriorityChange"
>) {
  const { t } = useTranslation();
  const statusOptions = getStatusOptions(t);
  const priorityOptions = getPriorityOptions(t);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t("common.status")}</Label>
          <Select
            value={status}
            onValueChange={(v) => onStatusChange(v as ProjectInputStatus)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("common.priority")}</Label>
          <Select
            value={priority}
            onValueChange={(v) => onPriorityChange(v as ProjectInputPriority)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((o) => (
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

export function ProjectFormDueDate({
  dueDate,
  onDueDateChange,
}: Pick<ProjectFormFieldsProps, "dueDate" | "onDueDateChange">) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="proj-due">{t("common.dueDate")}</Label>
        <Input
          id="proj-due"
          type="date"
          value={dueDate}
          onChange={(e) => onDueDateChange(e.target.value)}
        />
      </div>
    </div>
  );
}
