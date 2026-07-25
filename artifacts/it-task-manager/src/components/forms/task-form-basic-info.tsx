import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import type { OrgMemberInfo } from "@workspace/api-client-react";

interface TaskFormBasicInfoProps {
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  titleError?: string;
  onTitleErrorChange?: (e: string) => void;
  members: OrgMemberInfo[];
}

export function TaskFormBasicInfo({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  titleError,
  onTitleErrorChange,
  members,
}: TaskFormBasicInfoProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="task-title">
          {t("common.name")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="task-title"
          placeholder={t("tasks.titlePlaceholder")}
          value={title}
          onChange={(e) => {
            onTitleChange(e.target.value);
            onTitleErrorChange?.("");
          }}
        />
        {titleError && (
          <p className="text-xs text-destructive">{titleError}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>{t("common.description")}</Label>
        <MarkdownEditor
          value={description}
          onChange={onDescriptionChange}
          placeholder={t("tasks.descriptionPlaceholder")}
          className="h-48 border border-input rounded-md overflow-hidden"
          members={members}
        />
      </div>
    </div>
  );
}
