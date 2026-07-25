import { CustomFieldInputs } from "@/components/ui/custom-field-inputs";
import type { CustomFieldDefinition } from "@workspace/api-client-react";

interface TaskFormCustomFieldsProps {
  fields: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}

export function TaskFormCustomFields({
  fields,
  values,
  onChange,
}: TaskFormCustomFieldsProps) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No custom fields configured for this organization.
      </p>
    );
  }
  return (
    <CustomFieldInputs fields={fields} values={values} onChange={onChange} />
  );
}
