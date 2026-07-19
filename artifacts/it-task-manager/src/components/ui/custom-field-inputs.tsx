/**
 * CustomFieldInputs — renders input widgets for each active custom field definition.
 * Suitable for use in task creation/edit forms.
 */
import type { CustomFieldDefinition } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CustomFieldInputsProps {
  fields: CustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
}

export function CustomFieldInputs({ fields, values, onChange }: CustomFieldInputsProps) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Custom Fields
        </p>
        <div className="space-y-3">
          {fields.map((field) => {
            const id = String(field.id);
            const value = values[id];

            switch (field.type) {
              case "text":
                return (
                  <div key={id} className="space-y-1">
                    <Label htmlFor={`cf-${id}`} className="text-sm">{field.name}</Label>
                    <Input
                      id={`cf-${id}`}
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => onChange(id, e.target.value)}
                      placeholder={`Enter ${field.name.toLowerCase()}`}
                    />
                  </div>
                );

              case "number":
                return (
                  <div key={id} className="space-y-1">
                    <Label htmlFor={`cf-${id}`} className="text-sm">{field.name}</Label>
                    <Input
                      id={`cf-${id}`}
                      type="number"
                      value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
                      onChange={(e) => onChange(id, e.target.value === "" ? null : Number(e.target.value))}
                      placeholder={`Enter ${field.name.toLowerCase()}`}
                    />
                  </div>
                );

              case "date":
                return (
                  <div key={id} className="space-y-1">
                    <Label htmlFor={`cf-${id}`} className="text-sm">{field.name}</Label>
                    <Input
                      id={`cf-${id}`}
                      type="date"
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => onChange(id, e.target.value)}
                    />
                  </div>
                );

              case "single_select": {
                const options = field.options ?? [];
                const strVal = typeof value === "string" ? value : "";
                return (
                  <div key={id} className="space-y-1">
                    <Label className="text-sm">{field.name}</Label>
                    <Select
                      value={strVal}
                      onValueChange={(v) => onChange(id, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Select ${field.name.toLowerCase()}…`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground italic">None</span>
                        </SelectItem>
                        {options.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }

              case "multi_select": {
                const options = field.options ?? [];
                const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
                return (
                  <div key={id} className="space-y-1">
                    <Label className="text-sm">{field.name}</Label>
                    <div className="flex flex-wrap gap-2 p-2 border border-border rounded-md min-h-[38px] bg-background">
                      {options.map((opt) => {
                        const checked = selected.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              const next = checked
                                ? selected.filter((s) => s !== opt)
                                : [...selected, opt];
                              onChange(id, next);
                            }}
                            className={`text-xs px-2 py-1 rounded border transition-colors ${
                              checked
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80"
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                      {options.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No options configured</span>
                      )}
                    </div>
                  </div>
                );
              }

              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
}
