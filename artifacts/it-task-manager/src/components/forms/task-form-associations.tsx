import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@workspace/api-client-react";

interface TaskFormAssociationsProps {
  projectId: string;
  onProjectIdChange: (v: string) => void;
  projects: Project[];
  disabled?: boolean;
}

export function TaskFormAssociations({
  projectId,
  onProjectIdChange,
  projects,
  disabled,
}: TaskFormAssociationsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{t("tasks.filterByProject")}</Label>
        <Select
          value={projectId}
          onValueChange={onProjectIdChange}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("taskDetail.noProject")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("taskDetail.noProject")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
