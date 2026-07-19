/**
 * CustomFieldsManager — Admin UI for managing custom field definitions.
 * Rendered inside the Org Settings page.
 */
import { useState } from "react";
import {
  useListCustomFieldDefinitions,
  useCreateCustomFieldDefinition,
  useUpdateCustomFieldDefinition,
  useDeleteCustomFieldDefinition,
  useReorderCustomFieldDefinitions,
  getListCustomFieldDefinitionsQueryKey,
} from "@workspace/api-client-react";
import type { CustomFieldDefinition } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronUp, ChevronDown, GripVertical, Plus, Trash2, Check, X, Settings2 } from "lucide-react";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "single_select", label: "Single Select" },
  { value: "multi_select", label: "Multi Select" },
] as const;

type FieldType = typeof FIELD_TYPES[number]["value"];

function typeBadgeVariant(type: string) {
  switch (type) {
    case "text": return "secondary";
    case "number": return "outline";
    case "date": return "outline";
    case "single_select": return "default";
    case "multi_select": return "default";
    default: return "secondary";
  }
}

function typeLabel(type: string) {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: CustomFieldDefinition;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleted: () => void;
}

function FieldRow({ field, isFirst, isLast, onMoveUp, onMoveDown, onDeleted }: FieldRowProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(field.name);
  const [editingOptions, setEditingOptions] = useState(false);
  const [optionsText, setOptionsText] = useState((field.options ?? []).join("\n"));
  /** Set when the API returns 409 — holds pending opts + count of affected tasks. */
  const [optionConflict, setOptionConflict] = useState<{ opts: string[]; affectedCount: number } | null>(null);

  const isSelect = field.type === "single_select" || field.type === "multi_select";

  const { mutate: updateField, isPending: isUpdating } = useUpdateCustomFieldDefinition({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() });
        setEditingName(false);
        setEditingOptions(false);
        setOptionConflict(null);
      },
      onError: (err: Error) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const apiErr = err as any;
        if (apiErr?.status === 409 && typeof apiErr?.data?.affectedTaskCount === "number") {
          const opts = optionsText.split("\n").map((s: string) => s.trim()).filter(Boolean);
          setOptionConflict({ opts, affectedCount: apiErr.data.affectedTaskCount });
          return;
        }
        toast({ title: "Update failed", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: deleteField } = useDeleteCustomFieldDefinition({
    mutation: {
      onSuccess: () => {
        toast({ title: "Field deleted" });
        onDeleted();
      },
      onError: (err: Error) => {
        toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      },
    },
  });

  function saveName() {
    const trimmed = nameVal.trim();
    if (!trimmed || trimmed === field.name) { setEditingName(false); return; }
    updateField({ id: field.id, data: { name: trimmed } });
  }

  function saveOptions() {
    const opts = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    setOptionConflict(null);
    updateField({ id: field.id, data: { options: opts } });
  }

  function saveOptionsForce() {
    if (!optionConflict) return;
    updateField({ id: field.id, data: { options: optionConflict.opts, force: true } });
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 p-3">
        {/* Drag handle (visual only) */}
        <GripVertical className="w-4 h-4 text-muted-foreground/50 shrink-0" />

        {/* Name / edit name */}
        <div className="flex-1 min-w-0">
          {editingName ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); saveName(); }}
            >
              <Input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setNameVal(field.name), setEditingName(false))}
                className="h-7 text-sm"
                disabled={isUpdating}
              />
              <Button type="submit" size="icon" variant="ghost" className="h-7 w-7" disabled={isUpdating}>
                <Check className="w-3.5 h-3.5 text-green-500" />
              </Button>
              <Button
                type="button" size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => { setNameVal(field.name); setEditingName(false); }}
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </form>
          ) : (
            <button
              className="text-sm font-medium hover:text-primary transition-colors text-left w-full truncate"
              onClick={() => { setNameVal(field.name); setEditingName(true); }}
              title="Click to rename"
            >
              {field.name}
            </button>
          )}
        </div>

        {/* Type badge */}
        <Badge variant={typeBadgeVariant(field.type)} className="text-xs shrink-0 capitalize">
          {typeLabel(field.type)}
        </Badge>

        {/* Reorder */}
        <div className="flex flex-col shrink-0">
          <Button
            variant="ghost" size="icon" className="h-5 w-5" disabled={isFirst}
            onClick={onMoveUp} title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-5 w-5" disabled={isLast}
            onClick={onMoveDown} title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Options editor toggle (select types only) */}
        {isSelect && (
          <Button
            variant="ghost" size="icon" className="h-7 w-7 shrink-0"
            onClick={() => setEditingOptions((v) => !v)}
            title="Edit options"
          >
            <Settings2 className="w-4 h-4" />
          </Button>
        )}

        {/* Delete */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0">
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete custom field?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium">"{field.name}"</span> will be hidden from all task forms.
                Existing data in task records is preserved but will no longer be displayed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteField({ id: field.id })}
              >
                Delete field
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Inline options editor */}
      {isSelect && editingOptions && (
        <div className="border-t border-border px-4 pb-3 pt-2 space-y-2">
          {optionConflict ? (
            /* Conflict warning — shown after a 409 response */
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {optionConflict.affectedCount === 1
                  ? "1 task uses a removed option"
                  : `${optionConflict.affectedCount} tasks use a removed option`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Saving will clear the stale value from{" "}
                {optionConflict.affectedCount === 1 ? "that task" : "those tasks"} automatically.
                This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setOptionConflict(null)}
                >
                  Go back
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={saveOptionsForce}
                  disabled={isUpdating}
                >
                  {isUpdating ? "Saving…" : "Save and clear stale values"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">One option per line</p>
              <textarea
                className="w-full min-h-[96px] text-sm border border-border rounded-md p-2 bg-background resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={"Option A\nOption B\nOption C"}
              />
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { setOptionsText((field.options ?? []).join("\n")); setEditingOptions(false); }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={saveOptions} disabled={isUpdating}>
                  {isUpdating ? "Saving…" : "Save options"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddFieldForm ─────────────────────────────────────────────────────────────

interface AddFieldFormProps {
  onCancel: () => void;
  onCreated: () => void;
}

function AddFieldForm({ onCancel, onCreated }: AddFieldFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [optionsText, setOptionsText] = useState("");

  const isSelect = type === "single_select" || type === "multi_select";

  const { mutate: createField, isPending } = useCreateCustomFieldDefinition({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() });
        toast({ title: "Custom field created" });
        onCreated();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to create field", description: err.message, variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const options = isSelect
      ? optionsText.split("\n").map((s) => s.trim()).filter(Boolean)
      : undefined;
    createField({ data: { name: trimmedName, type, options } });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Field name</label>
          <Input
            autoFocus
            placeholder="e.g. Affected Service"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isSelect && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Options (one per line)</label>
          <textarea
            className="w-full min-h-[80px] text-sm border border-border rounded-md p-2 bg-background resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={"Option A\nOption B\nOption C"}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
          {isPending ? "Creating…" : "Add field"}
        </Button>
      </div>
    </form>
  );
}

// ─── CustomFieldsManager ──────────────────────────────────────────────────────

export function CustomFieldsManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: fields = [], isLoading } = useListCustomFieldDefinitions();

  const { mutate: reorder } = useReorderCustomFieldDefinitions({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() });
      },
      onError: (err: Error) => {
        toast({ title: "Reorder failed", description: err.message, variant: "destructive" });
      },
    },
  });

  function moveField(index: number, direction: -1 | 1) {
    const newFields = [...fields];
    const target = index + direction;
    if (target < 0 || target >= newFields.length) return;
    [newFields[index], newFields[target]] = [newFields[target], newFields[index]];
    reorder({ data: { ids: newFields.map((f) => f.id) } });
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading fields…</p>
      ) : fields.length === 0 && !showAddForm ? (
        <p className="text-sm text-muted-foreground italic">
          No custom fields yet. Add a field to extend every task in your org.
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, i) => (
            <FieldRow
              key={field.id}
              field={field}
              isFirst={i === 0}
              isLast={i === fields.length - 1}
              onMoveUp={() => moveField(i, -1)}
              onMoveDown={() => moveField(i, 1)}
              onDeleted={() =>
                queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() })
              }
            />
          ))}
        </div>
      )}

      {showAddForm ? (
        <AddFieldForm
          onCancel={() => setShowAddForm(false)}
          onCreated={() => setShowAddForm(false)}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 w-full border-dashed"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="w-4 h-4" />
          Add field
        </Button>
      )}
    </div>
  );
}
