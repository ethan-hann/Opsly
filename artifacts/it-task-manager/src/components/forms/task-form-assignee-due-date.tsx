import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";

interface TaskFormAssigneeDueDateProps {
  assignee: string;
  onAssigneeChange: (v: string) => void;
  dueDate: string;
  onDueDateChange: (v: string) => void;
  assigneeError?: string;
  onAssigneeErrorChange?: (e: string) => void;
}

export function TaskFormAssigneeDueDate({
  assignee,
  onAssigneeChange,
  dueDate,
  onDueDateChange,
  assigneeError,
  onAssigneeErrorChange,
}: TaskFormAssigneeDueDateProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t("common.assignee")}</Label>
          <AssigneeCombobox
            value={assignee}
            onChange={(v) => {
              onAssigneeChange(v);
              onAssigneeErrorChange?.("");
            }}
            error={assigneeError}
            onErrorChange={(err) => onAssigneeErrorChange?.(err)}
          />
          {assigneeError && (
            <p className="text-xs text-destructive">{assigneeError}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-due">{t("common.dueDate")}</Label>
          <Input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(e) => onDueDateChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
