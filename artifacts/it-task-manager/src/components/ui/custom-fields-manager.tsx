/**
 * CustomFieldsManager — Admin UI for managing custom field definitions.
 * Rendered inside the Org Settings page.
 */
import { useState, useEffect } from "react";
import {
  useListCustomFieldDefinitions,
  useCreateCustomFieldDefinition,
  useUpdateCustomFieldDefinition,
  useDeleteCustomFieldDefinition,
  usePurgeCustomFieldDefinition,
  useRestoreCustomFieldDefinition,
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
import { GripVertical, Plus, Trash2, Check, X, Settings2, Flame, Undo2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  onDeleted: () => void;
}

function FieldRow({ field, onDeleted }: FieldRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(field.name);
  const [editingOptions, setEditingOptions] = useState(false);
  const [optionsText, setOptionsText] = useState((field.options ?? []).join("\n"));
  /** Set when the API returns 409 — holds pending opts, count, IDs, and removed option values of affected tasks. */
  const [optionConflict, setOptionConflict] = useState<{
    opts: string[];
    affectedCount: number;
    affectedTaskIds: number[];
    removedOptions: string[];
  } | null>(null);

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
        const apiErr = err as any;
        if (apiErr?.status === 409 && typeof apiErr?.data?.affectedTaskCount === "number") {
          const opts = optionsText.split("\n").map((s: string) => s.trim()).filter(Boolean);
          const affectedTaskIds: number[] = Array.isArray(apiErr?.data?.affectedTaskIds)
            ? apiErr.data.affectedTaskIds
            : [];
          const currentOptions = (field.options as string[]) ?? [];
          const removedOptions = currentOptions.filter((o) => !opts.includes(o));
          setOptionConflict({ opts, affectedCount: apiErr.data.affectedTaskCount, affectedTaskIds, removedOptions });
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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-border bg-card${isDragging ? " opacity-50 shadow-lg ring-2 ring-primary/30 z-10" : ""}`}
    >
      <div className="flex items-center gap-2 p-3">
        {/* Drag handle */}
        <button
          {...listeners}
          {...attributes}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground shrink-0 touch-none"
          tabIndex={-1}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>

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
              {optionConflict.affectedTaskIds.length > 0 && (
                <Link
                  href={
                    optionConflict.removedOptions.length === 1
                      ? `/tasks?customFieldId=${field.id}&customFieldValue=${encodeURIComponent(optionConflict.removedOptions[0])}`
                      : `/tasks?ids=${optionConflict.affectedTaskIds.join(",")}`
                  }
                  className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
                >
                  View affected tasks
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
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

// ─── DeletedFieldRow ──────────────────────────────────────────────────────────

interface DeletedFieldRowProps {
  field: CustomFieldDefinition;
  onPurged: () => void;
  onRestored: () => void;
}

function DeletedFieldRow({ field, onPurged, onRestored }: DeletedFieldRowProps) {
  const { toast } = useToast();

  const { mutate: restoreField, isPending: isRestoring } = useRestoreCustomFieldDefinition({
    mutation: {
      onSuccess: () => {
        toast({ title: "Field restored", description: `"${field.name}" is active again.` });
        onRestored();
      },
      onError: (err: Error) => {
        toast({ title: "Restore failed", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: purgeField, isPending: isPurging } = usePurgeCustomFieldDefinition({
    mutation: {
      onSuccess: (data) => {
        const count = data.affectedTaskCount;
        toast({
          title: "Field permanently erased",
          description: count === 0
            ? "No task data was affected."
            : `Removed data from ${count} task${count === 1 ? "" : "s"}.`,
        });
        onPurged();
      },
      onError: (err: Error) => {
        toast({ title: "Purge failed", description: err.message, variant: "destructive" });
      },
    },
  });

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 opacity-60">
      <span className="flex-1 text-sm text-muted-foreground line-through truncate">{field.name}</span>
      <Badge variant="secondary" className="text-xs shrink-0 capitalize">{field.type.replace("_", " ")}</Badge>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs shrink-0"
        disabled={isRestoring || isPurging}
        onClick={() => restoreField({ id: field.id })}
      >
        <Undo2 className="w-3.5 h-3.5" />
        Restore
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
            disabled={isPurging || isRestoring}
          >
            <Flame className="w-3.5 h-3.5" />
            Purge all data
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently erase "{field.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the field definition and remove its stored value from
              every task in your org. <span className="font-semibold text-destructive">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => purgeField({ id: field.id })}
            >
              Erase permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── CustomFieldsManager ──────────────────────────────────────────────────────

export function CustomFieldsManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);

  // Fetch all fields including soft-deleted so we can show the purge section
  const { data: allFields = [], isLoading } = useListCustomFieldDefinitions(
    { includeSoftDeleted: true },
  );

  const serverFields = allFields.filter((f) => !f.deletedAt);
  const deletedFields = allFields.filter((f) => !!f.deletedAt);

  // Local optimistic order — synced from server whenever the server list changes
  const [fields, setFields] = useState<CustomFieldDefinition[]>(serverFields);
  useEffect(() => { setFields(serverFields); }, [allFields]); // intentional: allFields triggers the sync but applyTemplate is not a dep

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { mutate: reorder } = useReorderCustomFieldDefinitions({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() });
      },
      onError: (err: Error) => {
        // Roll back to server order on failure
        setFields(serverFields);
        toast({ title: "Reorder failed", description: err.message, variant: "destructive" });
      },
    },
  });

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(fields, oldIndex, newIndex);
    setFields(reordered); // optimistic
    reorder({ data: { ids: reordered.map((f) => f.id) } });
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListCustomFieldDefinitionsQueryKey() });
  }

  return (
    <div className="space-y-4">
      {/* Active fields */}
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading fields…</p>
        ) : fields.length === 0 && !showAddForm ? (
          <p className="text-sm text-muted-foreground italic">
            No custom fields yet. Add a field to extend every task in your org.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    onDeleted={invalidate}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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

      {/* Soft-deleted fields awaiting purge */}
      {deletedFields.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Deleted fields — data still on file
          </p>
          {deletedFields.map((field) => (
            <DeletedFieldRow key={field.id} field={field} onPurged={invalidate} onRestored={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}
