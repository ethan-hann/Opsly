import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInboundWebhooks,
  useCreateInboundWebhook,
  useUpdateInboundWebhook,
  useDeleteInboundWebhook,
  useRotateInboundWebhookSecret,
  useListProjects,
  useListCustomFieldDefinitions,
  getListInboundWebhooksQueryKey,
} from "@workspace/api-client-react";
import type {
  InboundWebhook,
  WebhookTaskTemplate,
  WebhookVisibility,
  CustomFieldDefinition,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Braces,
  Copy,
  Trash2,
  RefreshCw,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Plus,
  Lock,
  Eye,
  Globe,
  ShieldAlert,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast({ title: "Copied to clipboard" });
}

function buildFullIngestUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

function buildCurlCommand(fullUrl: string): string {
  return (
    `curl -X POST "${fullUrl}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{"title":"CPU spike on prod","priority":"high","category":"incident"}'`
  );
}

const VISIBILITY_OPTIONS: { value: WebhookVisibility; label: string; Icon: typeof Lock }[] = [
  { value: "private", label: "Private (only me)", Icon: Lock },
  { value: "public_read", label: "Shared — org members can view", Icon: Eye },
  { value: "public_write", label: "Public — org members can use & view", Icon: Globe },
];

// ─── Payload field reference ──────────────────────────────────────────────────

const PAYLOAD_FIELDS = [
  { name: "title",       type: "string",          required: true,  note: "Task title. Falls back to the Title field setting, then the Default title, then 'Untitled Alert'." },
  { name: "description", type: "string",          required: false, note: "Task description." },
  { name: "priority",    type: "string",          required: false, note: "low · medium · high · critical. Defaults to medium (or template default)." },
  { name: "category",    type: "string",          required: false, note: "incident · change · maintenance · deployment · support · other. Defaults to incident." },
  { name: "status",      type: "string",          required: false, note: "todo · in_progress · blocked · done. Defaults to todo; invalid values are ignored." },
  { name: "assignee",    type: "string",          required: false, note: "Assignee user ID or username. Passed through as-is." },
  { name: "dueDate",     type: "string | number", required: false, note: "Accepts YYYY-MM-DD, ISO 8601 (\"2025-03-15T10:30:00Z\"), or a Unix timestamp (seconds or ms). Can also be set via a field mapping below." },
];

// ─── Template Builder ─────────────────────────────────────────────────────────

type FieldMappingRow = { id: number; key: string; value: string };

const STATIC_MAPPING_OPTIONS = [
  { value: "title",       label: "Title",       hint: "string — overrides the Title field setting above" },
  { value: "description", label: "Description", hint: "string" },
  { value: "priority",    label: "Priority",    hint: "low · medium · high · critical" },
  { value: "category",    label: "Category",    hint: "incident · change · maintenance · deployment · support · other" },
  { value: "status",      label: "Status",      hint: "todo · in_progress · blocked · done" },
  { value: "assignee",    label: "Assignee",    hint: "user ID or username string" },
  { value: "dueDate",     label: "Due date",    hint: "YYYY-MM-DD, ISO 8601, or Unix timestamp (seconds or ms)" },
];

function TemplateBuilder({
  template,
  onChange,
  customFieldDefs = [],
  readOnly = false,
}: {
  template: WebhookTaskTemplate;
  onChange: (t: WebhookTaskTemplate) => void;
  customFieldDefs?: CustomFieldDefinition[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<FieldMappingRow[]>(() =>
    Object.entries(template.fieldMapping ?? {}).map(([key, value], id) => ({ id, key, value }))
  );

  function update(patch: Partial<WebhookTaskTemplate>) {
    onChange({ ...template, ...patch });
  }

  const mappingOptions = [
    ...STATIC_MAPPING_OPTIONS,
    ...(customFieldDefs.length > 0
      ? [
          { value: "__separator__", label: "── Custom fields ──", hint: "" },
          ...customFieldDefs.map((f) => ({
            value: `cf:${f.id}`,
            label: f.name,
            hint:
              f.type === "multi_select"
                ? `multi-select — send an array: ["A", "B"]`
                : f.type === "single_select"
                ? `single-select — one of: ${(f.options ?? []).join(" · ") || "any string"}`
                : f.type === "number"
                ? "number"
                : f.type === "date"
                ? "date — ISO string e.g. 2025-06-01"
                : "text",
          })),
        ]
      : []),
  ];

  function syncMapping(r: FieldMappingRow[]) {
    setRows(r);
    const m: Record<string, string> = {};
    r.forEach(({ key, value }) => {
      if (key && value && !value.startsWith("__")) m[key] = value;
    });
    update({ fieldMapping: Object.keys(m).length ? m : undefined });
  }

  function addRow() {
    syncMapping([...rows, { id: Date.now(), key: "", value: "" }]);
  }
  function removeRow(id: number) {
    syncMapping(rows.filter((r) => r.id !== id));
  }
  function updateRow(id: number, field: "key" | "value", val: string) {
    syncMapping(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  }

  return (
    <div className="space-y-6">
      {/* How-to callout */}
      <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground leading-relaxed space-y-1">
        <p className="font-medium text-foreground">How payload mapping works</p>
        <p>
          When an external system POSTs JSON to your ingest URL, Opsly reads specific keys from
          that JSON and uses them to fill in the task fields. These settings tell Opsly{" "}
          <em>where</em> to look in the JSON body.
        </p>
        <p>
          Use <strong>dot-notation</strong> to reach nested keys —{" "}
          <code className="bg-background px-1 rounded">labels.severity</code> reads{" "}
          <code className="bg-background px-1 rounded">{`{ "labels": { "severity": "high" } }`}</code>.
        </p>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label>Task title</Label>
        <p className="text-xs text-muted-foreground">
          Which JSON key holds the title? Leave blank and Opsly looks for a{" "}
          <code className="bg-muted px-1 rounded">title</code> key automatically.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Read title from</span>
            <Input
              placeholder="e.g. alertname"
              value={template.titleField ?? ""}
              onChange={(e) => update({ titleField: e.target.value || undefined })}
              className="h-8 text-sm"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Fallback when key is missing</span>
            <Input
              placeholder="Untitled Alert"
              value={template.defaultTitle ?? ""}
              onChange={(e) => update({ defaultTitle: e.target.value || undefined })}
              className="h-8 text-sm"
              disabled={readOnly}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label>
          Task description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          Which JSON key holds the description? Leave blank to use a{" "}
          <code className="bg-muted px-1 rounded">description</code> key. Supports
          dot-notation.
        </p>
        <Input
          placeholder="e.g. annotations.summary"
          value={template.descriptionField ?? ""}
          onChange={(e) => update({ descriptionField: e.target.value || undefined })}
          className="h-8 text-sm"
          disabled={readOnly}
        />
      </div>

      {/* Defaults */}
      <div className="space-y-1.5">
        <Label>Defaults</Label>
        <p className="text-xs text-muted-foreground">
          Applied when the incoming payload doesn't include a{" "}
          <code className="bg-muted px-1 rounded">priority</code> or{" "}
          <code className="bg-muted px-1 rounded">category</code> key.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Default priority</span>
            <Select
              value={template.defaultPriority ?? "__none__"}
              onValueChange={(v) =>
                update({
                  defaultPriority: (v === "__none__"
                    ? undefined
                    : v) as WebhookTaskTemplate["defaultPriority"],
                })
              }
              disabled={readOnly}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="medium (system default)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">medium (system default)</span>
                </SelectItem>
                {["low", "medium", "high", "critical"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Default category</span>
            <Select
              value={template.defaultCategory ?? "__none__"}
              onValueChange={(v) =>
                update({
                  defaultCategory: (v === "__none__"
                    ? undefined
                    : v) as WebhookTaskTemplate["defaultCategory"],
                })
              }
              disabled={readOnly}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="incident (system default)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">incident (system default)</span>
                </SelectItem>
                {["incident", "change", "maintenance", "deployment", "support", "other"].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Field remapping */}
      <div className="space-y-2">
        <div className="space-y-1">
          <Label>
            Remap payload fields{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            When your system uses different field names, map them here. For example, if
            your payload sends severity as{" "}
            <code className="bg-muted px-1 rounded">labels.severity</code>, map it to{" "}
            <strong>Priority</strong>. These take precedence over payload defaults.
          </p>
        </div>

        {customFieldDefs.length > 0 && (
          <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground leading-relaxed space-y-1">
            <p className="font-medium text-foreground">Setting custom fields from a payload</p>
            <p>Your org has custom fields. You can populate them from webhook payloads by mapping any payload key to a custom field target below.</p>
            <p>
              <strong>Text / number / date</strong> — send a plain value:{" "}
              <code className="bg-background px-1 rounded">{`"env": "production"`}</code>
            </p>
            <p><strong>Single-select</strong> — send one string matching an option label.</p>
            <p>
              <strong>Multi-select</strong> — send a JSON array:{" "}
              <code className="bg-background px-1 rounded">{`"tags": ["API", "P1"]`}</code>
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center">
              <span className="text-xs font-medium text-muted-foreground">From payload key</span>
              <span />
              <span className="text-xs font-medium text-muted-foreground">Maps to task field</span>
              <span />
            </div>
            {rows.map((row) => {
              const opt = mappingOptions.find((o) => o.value === row.value);
              const hint = opt && opt.value !== "__separator__" ? opt.hint : undefined;
              return (
                <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center">
                  <Input
                    placeholder="e.g. labels.severity"
                    value={row.key}
                    onChange={(e) => updateRow(row.id, "key", e.target.value)}
                    className="h-7 text-xs"
                    disabled={readOnly}
                  />
                  <span className="text-muted-foreground text-xs text-center">→</span>
                  <Select
                    value={row.value}
                    onValueChange={(v) => {
                      if (v === "__separator__") return;
                      updateRow(row.id, "value", v);
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="choose field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {mappingOptions.map((o) =>
                        o.value === "__separator__" ? (
                          <div
                            key="separator"
                            className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider select-none"
                          >
                            Custom fields
                          </div>
                        ) : (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                  {hint && (
                    <>
                      <span />
                      <span />
                      <p className="text-[10px] text-muted-foreground leading-tight pb-0.5">{hint}</p>
                      <span />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="h-7 text-xs gap-1"
          >
            <Plus className="w-3 h-3" /> Add field mapping
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebhookInboundEditPage({
  params,
}: {
  params: { id: string };
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isNew = params.id === "new";
  const hookId = isNew ? null : parseInt(params.id, 10);

  // Load the list (scoped to the user's org by the server) and find the target hook.
  const { data: hooks = [], isLoading: isLoadingList } = useListInboundWebhooks();
  const existing: InboundWebhook | undefined = hookId
    ? hooks.find((h) => h.id === hookId)
    : undefined;

  const { data: projects = [] } = useListProjects();
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const { data: allCustomFieldDefs = [] } = useListCustomFieldDefinitions();
  const activeCustomFieldDefs = allCustomFieldDefs.filter((f) => !f.deletedAt);

  // Form state — initialised from existing or empty.
  const [name, setName] = useState(existing?.name ?? "");
  const [projectId, setProjectId] = useState<number | null>(existing?.projectId ?? null);
  const [visibility, setVisibility] = useState<WebhookVisibility>(
    existing?.visibility ?? "private"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    existing?.rateLimitPerMinute ?? 60
  );
  const [template, setTemplate] = useState<WebhookTaskTemplate>(
    existing?.taskTemplate ?? {}
  );

  // Re-initialise if the existing webhook loads after mount (e.g. navigating
  // directly to the URL without the list being cached yet).
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (existing && !initialised) {
      setName(existing.name);
      setProjectId(existing.projectId ?? null);
      setVisibility(existing.visibility);
      setEnabled(existing.enabled);
      setRateLimitPerMinute(existing.rateLimitPerMinute ?? 60);
      setTemplate(existing.taskTemplate ?? {});
      setInitialised(true);
    }
    if (isNew && !initialised) setInitialised(true);
  }, [existing, isNew, initialised]);

  // Test payload state.
  const DEFAULT_TEST_PAYLOAD =
    '{\n  "title": "CPU spike on prod",\n  "priority": "high",\n  "category": "incident",\n  "description": "P99 latency exceeded 2s on api-server"\n}';
  const [testOpen, setTestOpen] = useState(false);
  const [testPayload, setTestPayload] = useState(DEFAULT_TEST_PAYLOAD);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const formatJson = useCallback((src: string): string => {
    try {
      return JSON.stringify(JSON.parse(src), null, 2);
    } catch {
      return src;
    }
  }, []);

  type TestState =
    | { status: "idle" }
    | { status: "loading" }
    | {
        status: "success";
        result: {
          title: string;
          description?: string;
          priority: string;
          category: string;
          dueDate?: string;
          customFields?: Record<string, unknown>;
        };
      }
    | { status: "error"; error: string };
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  async function handleTest() {
    // Auto-format before sending so a valid-but-messy payload always succeeds.
    const formatted = formatJson(testPayload);
    setTestPayload(formatted);
    setTestState({ status: "loading" });
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(formatted);
      setJsonError(null);
    } catch (e) {
      const msg = e instanceof SyntaxError ? e.message : "Invalid JSON";
      setJsonError(msg);
      setTestState({ status: "error", error: `Invalid JSON — ${msg}` });
      return;
    }
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/webhooks/inbound/test`.replace(/\/\//g, "/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, template }),
          credentials: "include",
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setTestState({ status: "error", error: data.error ?? "Request failed" });
      } else {
        setTestState({ status: "success", result: data });
      }
    } catch (err) {
      setTestState({
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  // Mutations.
  const { mutate: create, isPending: isCreating } = useCreateInboundWebhook({
    mutation: {
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Inbound webhook created" });
        setLocation(`/webhooks/inbound/${created.id}`);
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: deleteHook, isPending: isDeleting } = useDeleteInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Webhook deleted" });
        setLocation("/webhooks");
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: rotate, isPending: isRotating } = useRotateInboundWebhookSecret({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        const fullUrl = buildFullIngestUrl(data.ingestUrl);
        navigator.clipboard.writeText(fullUrl).catch(() => {});
        toast({ title: "Secret rotated", description: "New ingest URL copied to clipboard." });
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const isPending = isCreating || isUpdating || isDeleting || isRotating;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const data = {
      name: name.trim(),
      projectId: projectId ?? undefined,
      visibility,
      enabled,
      taskTemplate: template,
      rateLimitPerMinute,
    };
    if (existing) {
      update({ id: existing.id, data: { ...data, projectId: projectId } });
    } else {
      create({ data });
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  // While the list is loading we can't know if the hook exists yet.
  if (!isNew && isLoadingList) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // List loaded but the hook isn't in it — either wrong org or deleted.
  if (!isNew && !existing) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-4">
        <p className="text-muted-foreground">
          Webhook not found. It may have been deleted or doesn't belong to your
          organisation.
        </p>
        <Button variant="outline" onClick={() => setLocation("/webhooks")}>
          ← Back to Webhooks
        </Button>
      </div>
    );
  }

  // Non-owner: read-only view.
  const readOnly = !isNew && existing ? !existing.isOwner : false;

  // ── Derived ───────────────────────────────────────────────────────────────
  const fullUrl = existing ? buildFullIngestUrl(existing.ingestUrl) : null;
  const curlCmd = fullUrl ? buildCurlCommand(fullUrl) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
          onClick={() => setLocation("/webhooks")}
        >
          <ArrowLeft className="w-4 h-4" />
          Webhooks
        </Button>
      </div>

      {/* Page title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {isNew ? "New inbound webhook" : (existing?.name ?? "Inbound webhook")}
            </h1>
            {existing && (
              <Badge variant="secondary" className="text-xs">Inbound</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {isNew
              ? "POST any JSON to the generated URL — Opsly creates a task automatically."
              : "External systems POST JSON to this URL to create tasks automatically."}
          </p>
        </div>

        {/* Delete — only for owners of existing webhooks */}
        {existing && existing.isOwner && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/5 shrink-0"
                disabled={isPending}
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                <AlertDialogDescription>
                  The ingest URL will stop working immediately. Tasks already
                  created by this webhook are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteHook({ id: existing.id })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Read-only banner */}
      {readOnly && (
        <div className="flex items-center gap-2.5 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            You can view this webhook but not edit it — only its owner can make
            changes.
          </span>
        </div>
      )}

      {/* Ingest URL card — shown for existing webhooks */}
      {existing && fullUrl && curlCmd && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Ingest URL</Label>
                {existing.isOwner && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-amber-600"
                        disabled={isPending}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Rotate secret
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Rotate secret?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The current ingest URL will stop working immediately.
                          Any external system using it must be updated to the
                          new URL. The new URL is automatically copied to your
                          clipboard.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => rotate({ id: existing.id })}>
                          Rotate &amp; copy
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all">
                  {fullUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(fullUrl, toast)}
                  title="Copy ingest URL"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The URL itself is the secret — no authentication header required. Rotate it to invalidate the old URL.
              </p>
            </div>

            {/* curl example */}
            <div className="space-y-1.5">
              <Label className="text-sm">Example request</Label>
              <div className="relative">
                <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  {curlCmd}
                </pre>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1.5 right-1.5 h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(curlCmd, toast)}
                  title="Copy curl command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Payload field reference */}
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-1.5 select-none">
                <ChevronDown className="w-3.5 h-3.5 group-open:hidden" />
                <ChevronUp className="w-3.5 h-3.5 hidden group-open:block" />
                Accepted payload fields
              </summary>
              <div className="mt-2">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pr-3 pb-1 font-medium w-24">Field</th>
                      <th className="pr-3 pb-1 font-medium w-16">Type</th>
                      <th className="pr-3 pb-1 font-medium w-20">Required</th>
                      <th className="pb-1 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAYLOAD_FIELDS.map((f) => (
                      <tr key={f.name} className="border-t border-border/50">
                        <td className="pr-3 py-1 font-mono text-foreground">{f.name}</td>
                        <td className="pr-3 py-1 text-muted-foreground">{f.type}</td>
                        <td className="pr-3 py-1">
                          {f.required ? (
                            <span className="text-amber-600 font-medium">required</span>
                          ) : (
                            <span className="text-muted-foreground">optional</span>
                          )}
                        </td>
                        <td className="py-1 text-muted-foreground leading-relaxed">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2.5 text-xs text-muted-foreground">
                  Custom fields are also accepted — configure which payload keys map to them in the{" "}
                  <span className="font-medium text-foreground">Field mappings</span> section below.
                </p>
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Settings form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic settings */}
        <Card>
          <CardContent className="py-5 space-y-5">
            <h2 className="text-sm font-semibold">Settings</h2>

            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Datadog alerts"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={readOnly || isPending}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Project (optional)</Label>
                <Select
                  value={projectId?.toString() ?? "__none__"}
                  onValueChange={(v) => setProjectId(v === "__none__" ? null : Number(v))}
                  disabled={readOnly || isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project</SelectItem>
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as WebhookVisibility)}
                  disabled={readOnly || isPending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 items-start">
              <div className="space-y-1.5">
                <Label htmlFor="rateLimit">Rate limit (tasks / minute)</Label>
                <p className="text-xs text-muted-foreground">
                  Allowed range: 1–10,000. Requests that exceed this cap return{" "}
                  <code className="bg-muted px-1 rounded">429</code> with a{" "}
                  <code className="bg-muted px-1 rounded">Retry-After: 60</code> header.
                </p>
                <input
                  id="rateLimit"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={rateLimitPerMinute}
                  onChange={(e) =>
                    setRateLimitPerMinute(
                      Math.max(1, Math.min(10000, Number(e.target.value) || 60))
                    )
                  }
                  disabled={readOnly || isPending}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enabled-toggle">Enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Disabled webhooks reject incoming requests with 404.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    id="enabled-toggle"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    disabled={readOnly || isPending}
                  />
                  <span className="text-sm">{enabled ? "Active" : "Disabled"}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Echo warning */}
        <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Inbound tasks fire outbound events</p>
            <p>
              When an external system POSTs to this ingest URL, Opsly creates a
              task and immediately fires a{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                task.created
              </code>{" "}
              outbound event. If that system also subscribes to your outbound
              webhooks, it will receive an echo of its own action — which can
              cause loops. Make sure your external system ignores events it
              originally triggered.
            </p>
          </div>
        </div>

        {/* Payload mapping */}
        <Card>
          <CardContent className="py-5 space-y-5">
            <h2 className="text-sm font-semibold">Payload mapping</h2>
            <TemplateBuilder
              template={template}
              onChange={setTemplate}
              customFieldDefs={activeCustomFieldDefs}
              readOnly={readOnly}
            />
          </CardContent>
        </Card>

        {/* Test payload */}
        <Card>
          <CardContent className="py-0">
            <button
              type="button"
              className="w-full flex items-center justify-between px-0 py-4 text-sm font-medium text-left hover:text-foreground transition-colors"
              onClick={() => setTestOpen((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Test with sample payload
              </span>
              {testOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {testOpen && (
              <div className="pb-5 space-y-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Paste a JSON payload to preview what task fields this webhook
                  would create, given your current template settings. Your changes
                  don't need to be saved first.
                </p>
                <div className="space-y-1">
                  <Textarea
                    ref={textareaRef}
                    value={testPayload}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTestPayload(val);
                      setTestState({ status: "idle" });
                      // Live validation
                      if (val.trim() === "") {
                        setJsonError(null);
                      } else {
                        try {
                          JSON.parse(val);
                          setJsonError(null);
                        } catch (err) {
                          setJsonError(
                            err instanceof SyntaxError ? err.message : "Invalid JSON"
                          );
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      // Tab → insert two spaces instead of moving focus
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const el = e.currentTarget;
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        const next = testPayload.slice(0, start) + "  " + testPayload.slice(end);
                        setTestPayload(next);
                        // Restore cursor after React re-renders
                        requestAnimationFrame(() => {
                          el.selectionStart = el.selectionEnd = start + 2;
                        });
                      }
                    }}
                    onBlur={() => {
                      // Auto-format on blur if the JSON is valid
                      if (!jsonError && testPayload.trim()) {
                        setTestPayload(formatJson(testPayload));
                      }
                    }}
                    className={[
                      "font-mono text-xs min-h-[140px] resize-y",
                      jsonError ? "border-destructive focus-visible:ring-destructive" : "",
                    ].join(" ")}
                    spellCheck={false}
                  />
                  {jsonError && (
                    <p className="text-xs text-destructive flex items-start gap-1.5">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {jsonError}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={handleTest}
                    disabled={testState.status === "loading" || !!jsonError}
                  >
                    {testState.status === "loading" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Terminal className="w-3.5 h-3.5" />
                    )}
                    Parse payload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setTestPayload(formatJson(testPayload))}
                    disabled={!testPayload.trim() || !!jsonError}
                    title="Format JSON"
                  >
                    <Braces className="w-3.5 h-3.5" />
                    Format
                  </Button>
                </div>
                {testState.status === "error" && !jsonError && (
                  <p className="text-xs text-destructive">{testState.error}</p>
                )}
                {testState.status === "success" && (
                  <div className="rounded-md border bg-muted/40 divide-y text-xs">
                    {(
                      [
                        ["Title", testState.result.title],
                        ["Priority", testState.result.priority],
                        ["Category", testState.result.category],
                        ...(testState.result.description
                          ? [["Description", testState.result.description]]
                          : []),
                        ...(testState.result.dueDate
                          ? [["Due date", testState.result.dueDate]]
                          : []),
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label} className="flex px-3 py-1.5 gap-3">
                        <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                        <span className="font-medium break-all">{value}</span>
                      </div>
                    ))}
                    {Object.entries(testState.result.customFields ?? {}).map(([cfId, val]) => {
                      const def = activeCustomFieldDefs.find((f) => String(f.id) === cfId);
                      const label = def ? def.name : `Custom field #${cfId}`;
                      const display = Array.isArray(val) ? val.join(", ") : String(val ?? "");
                      return (
                        <div key={cfId} className="flex px-3 py-1.5 gap-3">
                          <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                          <span className="font-medium break-all">{display}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save / cancel */}
        {!readOnly && (
          <div className="flex items-center gap-3 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLocation("/webhooks")}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : isNew ? (
                "Create webhook"
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
