import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInboundWebhooks,
  useCreateInboundWebhook,
  useUpdateInboundWebhook,
  useDeleteInboundWebhook,
  useRotateInboundWebhookSecret,
  useListOutboundWebhooks,
  useCreateOutboundWebhook,
  useUpdateOutboundWebhook,
  useDeleteOutboundWebhook,
  useListOutboundWebhookDeliveries,
  getListInboundWebhooksQueryKey,
  getListOutboundWebhooksQueryKey,
} from "@workspace/api-client-react";
import type {
  InboundWebhook,
  OutboundWebhook,
  OutboundWebhookDelivery,
  WebhookTaskTemplate,
  WebhookVisibility,
} from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import {
  Webhook,
  Plus,
  Copy,
  Trash2,
  Pencil,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  ChevronUp,
  Globe,
  Lock,
  Eye,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const VISIBILITY_LABELS: Record<
  WebhookVisibility,
  { label: string; Icon: typeof Lock }
> = {
  private: { label: "Private", Icon: Lock },
  public_read: { label: "Shared (read-only)", Icon: Eye },
  public_write: { label: "Public", Icon: Globe },
};

const ALL_EVENTS = [
  { value: "task.created", label: "Task created" },
  { value: "task.updated", label: "Task updated" },
  { value: "task.status_changed", label: "Task status changed" },
  { value: "task.assigned", label: "Task assigned" },
  { value: "task.commented", label: "Task commented" },
  { value: "project.created", label: "Project created" },
  { value: "project.updated", label: "Project updated" },
  { value: "note.created", label: "Note created" },
  { value: "note.updated", label: "Note updated" },
  { value: "note.deleted", label: "Note deleted" },
] as const;

type EventValue = (typeof ALL_EVENTS)[number]["value"];

function buildFullIngestUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast({ title: "Copied to clipboard" });
}

function VisibilityBadge({ v }: { v: WebhookVisibility }) {
  const { label } = VISIBILITY_LABELS[v] ?? VISIBILITY_LABELS.private;
  return (
    <Badge variant="outline" className="text-xs gap-1">
      {label}
    </Badge>
  );
}

// ─── Delivery Log ───────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DeliveryRow({ d }: { d: OutboundWebhookDelivery }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-xs border-b border-border/30 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 py-2 px-3 hover:bg-muted/40 transition-colors text-left"
      >
        {d.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
        )}
        <span className="font-mono text-muted-foreground w-8 shrink-0">
          {d.statusCode ?? "err"}
        </span>
        <span className="text-foreground/80 flex-1 truncate">{d.event}</span>
        <span className="flex items-center gap-1 text-muted-foreground shrink-0">
          <Clock className="w-3 h-3" />
          {formatDuration(d.durationMs)}
        </span>
        <span className="text-muted-foreground shrink-0 w-16 text-right">
          {formatTimeAgoShort(d.createdAt)}
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1 text-muted-foreground bg-muted/20">
          <div className="flex gap-2">
            <span className="font-medium text-foreground/60 w-16 shrink-0">URL</span>
            <code className="truncate">{d.url}</code>
          </div>
          {d.error && (
            <div className="flex gap-2">
              <span className="font-medium text-foreground/60 w-16 shrink-0">Error</span>
              <span className="text-destructive break-all">{d.error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="font-medium text-foreground/60 w-16 shrink-0">Status</span>
            <span>{d.success ? "Success" : "Failed"} · {formatDuration(d.durationMs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryLogContent({ webhookId }: { webhookId: number }) {
  const { data: deliveries, isFetching } = useListOutboundWebhookDeliveries(webhookId);

  return (
    <div className="mt-2 rounded-md border border-border/50 overflow-hidden bg-card">
      {isFetching && !deliveries ? (
        <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
      ) : !deliveries || deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No deliveries recorded yet. They appear here after the next matching event fires.
        </p>
      ) : (
        <div>
          {deliveries.map((d) => (
            <DeliveryRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryLog({ webhookId }: { webhookId: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border/40 mt-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Activity className="w-3.5 h-3.5" />
        <span className="font-medium">Recent deliveries</span>
        <span className="ml-auto">
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {open && <DeliveryLogContent webhookId={webhookId} />}
    </div>
  );
}

// ─── Task Template Builder ───────────────────────────────────────────────────

type FieldMappingRow = { id: number; key: string; value: string };

interface TemplateBuilderProps {
  template: WebhookTaskTemplate;
  onChange: (t: WebhookTaskTemplate) => void;
}

// Valid task fields that fieldMapping can target (mirrors applyTemplate on the server).
const MAPPING_TARGET_OPTIONS = [
  { value: "priority", label: "Priority", hint: "low · medium · high · critical" },
  { value: "category", label: "Category", hint: "incident · change · maintenance · deployment · support · other" },
] as const;

function TemplateBuilder({ template, onChange }: TemplateBuilderProps) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<FieldMappingRow[]>(() =>
    Object.entries(template.fieldMapping ?? {}).map(([key, value], id) => ({
      id,
      key,
      value,
    })),
  );

  function update(patch: Partial<WebhookTaskTemplate>) {
    onChange({ ...template, ...patch });
  }

  function syncMapping(r: FieldMappingRow[]) {
    setRows(r);
    const m: Record<string, string> = {};
    r.forEach(({ key, value }) => {
      if (key && value) m[key] = value;
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
    const next = rows.map((r) => (r.id === id ? { ...r, [field]: val } : r));
    syncMapping(next);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-sm font-medium hover:text-foreground transition-colors group"
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-foreground">Payload mapping</span>
          <span className="text-xs font-normal text-muted-foreground">
            {expanded
              ? "Collapse field settings"
              : "Optional — customize how incoming JSON becomes a task"}
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-5">

          {/* How it works callout */}
          <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground leading-relaxed space-y-1">
            <p className="font-medium text-foreground">How payload mapping works</p>
            <p>
              When an external system POSTs JSON to your ingest URL, Opsly reads
              specific keys from that JSON and uses them to fill in the task fields.
              These settings tell Opsly <em>where</em> to look in the JSON body.
            </p>
            <p>
              Use <strong>dot-notation</strong> to reach nested keys —{" "}
              <code className="bg-background px-1 rounded">labels.severity</code> reads{" "}
              <code className="bg-background px-1 rounded">{`{ "labels": { "severity": "high" } }`}</code>.
            </p>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-sm">Task title</Label>
            <p className="text-xs text-muted-foreground">
              Which JSON key holds the title? Leave blank and Opsly looks for a{" "}
              <code className="bg-muted px-1 rounded">title</code> key automatically.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Read title from</span>
                <Input
                  placeholder="e.g. alertname"
                  value={template.titleField ?? ""}
                  onChange={(e) =>
                    update({ titleField: e.target.value || undefined })
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Fallback when key is missing</span>
                <Input
                  placeholder="Untitled Alert"
                  value={template.defaultTitle ?? ""}
                  onChange={(e) =>
                    update({ defaultTitle: e.target.value || undefined })
                  }
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm">Task description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <p className="text-xs text-muted-foreground">
              Which JSON key holds the description? Leave blank and Opsly looks for a{" "}
              <code className="bg-muted px-1 rounded">description</code> key. Supports dot-notation.
            </p>
            <Input
              placeholder="e.g. annotations.summary"
              value={template.descriptionField ?? ""}
              onChange={(e) =>
                update({ descriptionField: e.target.value || undefined })
              }
              className="h-8 text-sm"
            />
          </div>

          {/* Defaults */}
          <div className="space-y-1.5">
            <Label className="text-sm">Defaults</Label>
            <p className="text-xs text-muted-foreground">
              Applied when the incoming payload doesn't include a{" "}
              <code className="bg-muted px-1 rounded">priority</code> or{" "}
              <code className="bg-muted px-1 rounded">category</code> key.
            </p>
            <div className="grid grid-cols-2 gap-2">
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
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="medium (system default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">medium (system default)</span>
                    </SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
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
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="incident (system default)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">incident (system default)</span>
                    </SelectItem>
                    {["incident", "change", "maintenance", "deployment", "support", "other"].map(
                      (c) => (
                        <SelectItem key={c} value={c}>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Field remapping */}
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-sm">Remap payload fields <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <p className="text-xs text-muted-foreground">
                When your system uses different field names, map them here. For example, if your
                payload sends severity as{" "}
                <code className="bg-muted px-1 rounded">labels.severity</code>, map it to{" "}
                <strong>Priority</strong>. These take precedence over payload defaults.
              </p>
            </div>
            {rows.length > 0 && (
              <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 gap-y-1.5 items-center">
                <span className="text-xs font-medium text-muted-foreground">From payload key</span>
                <span />
                <span className="text-xs font-medium text-muted-foreground">Maps to task field</span>
                <span />
                {rows.map((row) => (
                  <>
                    <Input
                      key={`key-${row.id}`}
                      placeholder="e.g. labels.severity"
                      value={row.key}
                      onChange={(e) => updateRow(row.id, "key", e.target.value)}
                      className="h-7 text-xs"
                    />
                    <span className="text-muted-foreground text-xs text-center">→</span>
                    <Select
                      value={row.value}
                      onValueChange={(v) => updateRow(row.id, "value", v)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="choose field…" />
                      </SelectTrigger>
                      <SelectContent>
                        {MAPPING_TARGET_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            <span className="flex flex-col">
                              <span>{o.label}</span>
                              <span className="text-[10px] text-muted-foreground">{o.hint}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              className="h-7 text-xs gap-1"
            >
              <Plus className="w-3 h-3" /> Add field mapping
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inbound Webhook Dialog ──────────────────────────────────────────────────

interface InboundDialogProps {
  open: boolean;
  onClose: () => void;
  existing?: InboundWebhook;
  projectOptions: { id: number; name: string }[];
}

function InboundDialog({
  open,
  onClose,
  existing,
  projectOptions,
}: InboundDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [projectId, setProjectId] = useState<number | null>(
    existing?.projectId ?? null,
  );
  const [visibility, setVisibility] = useState<WebhookVisibility>(
    existing?.visibility ?? "private",
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    existing?.rateLimitPerMinute ?? 60,
  );
  const [template, setTemplate] = useState<WebhookTaskTemplate>(
    existing?.taskTemplate ?? {},
  );

  function reset() {
    setName(existing?.name ?? "");
    setProjectId(existing?.projectId ?? null);
    setVisibility(existing?.visibility ?? "private");
    setEnabled(existing?.enabled ?? true);
    setRateLimitPerMinute(existing?.rateLimitPerMinute ?? 60);
    setTemplate(existing?.taskTemplate ?? {});
  }

  function handleClose() {
    reset();
    onClose();
  }

  const { mutate: create, isPending: isCreating } = useCreateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Inbound webhook created" });
        handleClose();
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
        handleClose();
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const isPending = isCreating || isUpdating;

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit inbound webhook" : "New inbound webhook"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              placeholder="Datadog alerts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <Label>Project (optional)</Label>
            <Select
              value={projectId?.toString() ?? "__none__"}
              onValueChange={(v) =>
                setProjectId(v === "__none__" ? null : Number(v))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No project - tasks are unlinked" />
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

          <div className="space-y-1">
            <Label>Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as WebhookVisibility)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (only me)</SelectItem>
                <SelectItem value="public_read">
                  Shared - org members can view
                </SelectItem>
                <SelectItem value="public_write">
                  Public - org members can use &amp; view
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              id="enabled"
            />
            <Label htmlFor="enabled">Enabled</Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rateLimit">Rate limit (tasks / minute)</Label>
            <p className="text-xs text-muted-foreground">
              Requests that exceed this cap return&nbsp;
              <code className="bg-muted px-1 rounded text-xs">429</code> with a
              &nbsp;<code className="bg-muted px-1 rounded text-xs">Retry-After: 60</code>&nbsp;
              header. Default&nbsp;60.
            </p>
            <input
              id="rateLimit"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={rateLimitPerMinute}
              onChange={(e) =>
                setRateLimitPerMinute(Math.max(1, Math.min(10000, Number(e.target.value) || 60)))
              }
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <TemplateBuilder template={template} onChange={setTemplate} />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending
                ? "Saving…"
                : existing
                  ? "Save changes"
                  : "Create webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payload field reference ──────────────────────────────────────────────────

const PAYLOAD_FIELDS = [
  {
    name: "title",
    type: "string",
    required: true,
    note: 'Task title. Falls back to the webhook\'s "Default title" or "Untitled Alert".',
  },
  {
    name: "description",
    type: "string",
    required: false,
    note: "Task description.",
  },
  {
    name: "priority",
    type: "string",
    required: false,
    note: "low · medium · high · critical. Defaults to medium (or template default).",
  },
  {
    name: "category",
    type: "string",
    required: false,
    note: "incident · change · maintenance · deployment · support · other. Defaults to incident.",
  },
  {
    name: "dueDate",
    type: "string",
    required: false,
    note: "Due date in YYYY-MM-DD format.",
  },
] as const;

function buildCurlCommand(fullUrl: string): string {
  return (
    `curl -X POST "${fullUrl}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{"title":"CPU spike on prod","priority":"high","category":"incident"}'`
  );
}

interface InboundHookCardProps {
  h: InboundWebhook;
  proj: { id: number; name: string } | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
}

function InboundHookCard({
  h,
  proj,
  onEdit,
  onDelete,
  onToggle,
  onRotate,
}: InboundHookCardProps) {
  const { toast } = useToast();
  const [docsOpen, setDocsOpen] = useState(false);
  const fullUrl = buildFullIngestUrl(h.ingestUrl);
  const curlCmd = buildCurlCommand(fullUrl);

  return (
    <Card className={h.enabled ? "" : "opacity-60"}>
      <CardContent className="py-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{h.name}</span>
              <VisibilityBadge v={h.visibility} />
              {proj && (
                <Badge variant="secondary" className="text-xs">
                  {proj.name}
                </Badge>
              )}
              {!h.enabled && (
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground"
                >
                  Disabled
                </Badge>
              )}
            </div>

            {/* Ingest URL */}
            <div className="flex items-center gap-2 mt-2">
              <code className="text-xs bg-muted px-2 py-1 rounded-md truncate max-w-sm">
                {fullUrl}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => copyText(fullUrl, toast)}
                title="Copy ingest URL"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Template summary */}
            {(h.taskTemplate?.defaultPriority ||
              h.taskTemplate?.defaultCategory ||
              h.taskTemplate?.titleField) && (
              <p className="text-xs text-muted-foreground mt-1">
                Template:{" "}
                {[
                  h.taskTemplate.titleField &&
                    `title from "${h.taskTemplate.titleField}"`,
                  h.taskTemplate.defaultPriority &&
                    `${h.taskTemplate.defaultPriority} priority`,
                  h.taskTemplate.defaultCategory &&
                    `${h.taskTemplate.defaultCategory} category`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {/* Rate-limit badge */}
            <p className="text-xs text-muted-foreground mt-1">
              Rate limit:{" "}
              <span className="font-medium text-foreground">
                {h.rateLimitPerMinute} tasks / min
              </span>
            </p>

            {/* How-to toggle */}
            <button
              type="button"
              onClick={() => setDocsOpen((v) => !v)}
              className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              How to send data
              {docsOpen ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>

          {/* Actions */}
          {h.isOwner && (
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={h.enabled}
                onCheckedChange={onToggle}
                className="scale-75"
                title={h.enabled ? "Disable webhook" : "Enable webhook"}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                    title="Rotate secret (generates a new URL)"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rotate secret?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The current ingest URL will stop working immediately. Any
                      external system using it must be updated to the new URL.
                      The new URL is automatically copied to your clipboard.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onRotate}>
                      Rotate &amp; copy
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={onEdit}
                title="Edit"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The ingest URL will stop working. Tasks already created by
                      this webhook are kept.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={onDelete}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        {/* Expandable docs */}
        {docsOpen && (
          <div className="border border-border rounded-md bg-muted/30 p-3 space-y-3 text-xs">
            {/* Payload fields */}
            <div>
              <p className="font-medium text-foreground mb-2">
                Accepted payload fields
              </p>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pr-3 pb-1 font-medium w-24">Field</th>
                    <th className="pr-3 pb-1 font-medium w-16">Type</th>
                    <th className="pr-3 pb-1 font-medium w-16">Required</th>
                    <th className="pb-1 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {PAYLOAD_FIELDS.map((f) => (
                    <tr key={f.name} className="border-t border-border/50">
                      <td className="pr-3 py-1 font-mono text-foreground">
                        {f.name}
                      </td>
                      <td className="pr-3 py-1 text-muted-foreground">
                        {f.type}
                      </td>
                      <td className="pr-3 py-1">
                        {f.required ? (
                          <span className="text-amber-600 font-medium">
                            required
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            optional
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-muted-foreground leading-relaxed">
                        {f.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-muted-foreground">
                Any additional fields are ignored. No authentication header is
                required - the URL itself is secret.
              </p>
            </div>

            {/* Curl example */}
            <div>
              <p className="font-medium text-foreground mb-1.5">
                Example request
              </p>
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

            {/* Response info */}
            <div>
              <p className="font-medium text-foreground mb-1">Response</p>
              <p className="text-muted-foreground">
                On success the endpoint returns{" "}
                <span className="font-mono text-foreground">201</span> with{" "}
                <span className="font-mono text-foreground">
                  {"{ taskId, orgTaskNumber, title }"}
                </span>
                . An empty payload (
                <span className="font-mono text-foreground">{"{}"}</span>) is
                accepted and creates a task titled "Untitled Alert".
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Inbound tab ─────────────────────────────────────────────────────────────

function InboundTab({
  projectOptions,
}: {
  projectOptions: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: hooks = [] } = useListInboundWebhooks();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<InboundWebhook | null>(null);

  const { mutate: deleteHook } = useDeleteInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Webhook deleted" });
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const { mutate: toggleEnabled } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() }),
    },
  });

  const { mutate: rotate } = useRotateInboundWebhookSecret({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        copyText(buildFullIngestUrl(data.ingestUrl), toast);
        toast({
          title: "Secret rotated",
          description: "New ingest URL copied to clipboard.",
        });
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          POST any JSON to an ingest URL and Opsly creates a task automatically.
        </p>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-4 h-4" /> New webhook
        </Button>
      </div>

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowDownLeft className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No inbound webhooks yet.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> Create your first
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => (
            <InboundHookCard
              key={h.id}
              h={h}
              proj={projectOptions.find((p) => p.id === h.projectId)}
              onEdit={() => setEditing(h)}
              onDelete={() => deleteHook({ id: h.id })}
              onToggle={(v) =>
                toggleEnabled({ id: h.id, data: { enabled: v } })
              }
              onRotate={() => rotate({ id: h.id })}
            />
          ))}
        </div>
      )}

      <InboundDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectOptions={projectOptions}
      />
      {editing && (
        <InboundDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          existing={editing}
          projectOptions={projectOptions}
        />
      )}
    </div>
  );
}

// ─── Outbound Webhook Dialog ──────────────────────────────────────────────────

interface OutboundDialogProps {
  open: boolean;
  onClose: () => void;
  existing?: OutboundWebhook;
  projectOptions: { id: number; name: string }[];
}

function OutboundDialog({
  open,
  onClose,
  existing,
  projectOptions,
}: OutboundDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [projectId, setProjectId] = useState<number | null>(
    existing?.projectId ?? null,
  );
  const [events, setEvents] = useState<EventValue[]>(
    (existing?.events as EventValue[]) ?? [],
  );
  const [visibility, setVisibility] = useState<WebhookVisibility>(
    existing?.visibility ?? "private",
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  function reset() {
    setName(existing?.name ?? "");
    setUrl(existing?.url ?? "");
    setProjectId(existing?.projectId ?? null);
    setEvents((existing?.events as EventValue[]) ?? []);
    setVisibility(existing?.visibility ?? "private");
    setEnabled(existing?.enabled ?? true);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleEvent(ev: EventValue) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }

  const { mutate: create, isPending: isCreating } = useCreateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Outbound webhook created" });
        handleClose();
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
        handleClose();
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const isPending = isCreating || isUpdating;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || events.length === 0) return;
    const data = {
      name: name.trim(),
      url: url.trim(),
      projectId: projectId ?? undefined,
      events,
      visibility,
      enabled,
    };
    if (existing) {
      update({ id: existing.id, data: { ...data, projectId: projectId } });
    } else {
      create({ data });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit outbound webhook" : "New outbound webhook"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              placeholder="Slack notifications"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <Label>Target URL</Label>
            <Input
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              required
            />
            <p className="text-xs text-muted-foreground">
              Opsly signs each POST with <code>X-Opsly-Signature</code>{" "}
              (HMAC-SHA256).
            </p>
          </div>

          <div className="space-y-1">
            <Label>Project filter (optional)</Label>
            <Select
              value={projectId?.toString() ?? "__none__"}
              onValueChange={(v) =>
                setProjectId(v === "__none__" ? null : Number(v))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All projects</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Events</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EVENTS.map((ev) => {
                const checked = events.includes(ev.value);
                return (
                  <label
                    key={ev.value}
                    className={[
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                      checked
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-accent",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEvent(ev.value)}
                      className="accent-primary"
                    />
                    {ev.label}
                  </label>
                );
              })}
            </div>
            {events.length === 0 && (
              <p className="text-xs text-destructive">
                Select at least one event.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as WebhookVisibility)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (only me)</SelectItem>
                <SelectItem value="public_read">
                  Shared - org members can view
                </SelectItem>
                <SelectItem value="public_write">
                  Public - org members can view &amp; use
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              id="out-enabled"
            />
            <Label htmlFor="out-enabled">Enabled</Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || !name.trim() || !url.trim() || events.length === 0
              }
            >
              {isPending
                ? "Saving…"
                : existing
                  ? "Save changes"
                  : "Create webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Outbound tab ─────────────────────────────────────────────────────────────

function OutboundTab({
  projectOptions,
}: {
  projectOptions: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: hooks = [] } = useListOutboundWebhooks();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OutboundWebhook | null>(null);

  const { mutate: deleteHook } = useDeleteOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Webhook deleted" });
      },
      onError: (e: Error) =>
        toast({
          title: "Error",
          description: e.message,
          variant: "destructive",
        }),
    },
  });

  const { mutate: toggleEnabled } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Opsly POSTs signed event payloads to your endpoints when tasks or
          projects change.
        </p>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-4 h-4" /> New webhook
        </Button>
      </div>

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowUpRight className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No outbound webhooks yet.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> Create your first
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => {
            const proj = projectOptions.find((p) => p.id === h.projectId);
            return (
              <Card key={h.id} className={h.enabled ? "" : "opacity-60"}>
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{h.name}</span>
                        <VisibilityBadge v={h.visibility} />
                        {proj && (
                          <Badge variant="secondary" className="text-xs">
                            {proj.name}
                          </Badge>
                        )}
                        {!proj && (
                          <Badge
                            variant="outline"
                            className="text-xs text-muted-foreground"
                          >
                            All projects
                          </Badge>
                        )}
                        {!h.enabled && (
                          <Badge
                            variant="outline"
                            className="text-xs text-muted-foreground"
                          >
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {/* Target URL */}
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-muted-foreground truncate max-w-sm">
                          {h.url}
                        </code>
                      </div>
                      {/* Signing secret */}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          Secret:
                        </span>
                        <code className="text-xs bg-muted px-2 py-0.5 rounded-md truncate max-w-[200px]">
                          {h.secret}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => copyText(h.secret, toast)}
                          title="Copy signing secret"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      {/* Events */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(h.events as string[]).map((ev) => (
                          <Badge key={ev} variant="outline" className="text-xs">
                            {ev}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    {h.isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={h.enabled}
                          onCheckedChange={(v) =>
                            toggleEnabled({ id: h.id, data: { enabled: v } })
                          }
                          className="scale-75"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditing(h)}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete webhook?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Opsly will stop sending events to{" "}
                                <strong>{h.url}</strong>.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteHook({ id: h.id })}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>

                  {/* Delivery log */}
                  <DeliveryLog webhookId={h.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <OutboundDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectOptions={projectOptions}
      />
      {editing && (
        <OutboundDialog
          open={!!editing}
          onClose={() => setEditing(null)}
          existing={editing}
          projectOptions={projectOptions}
        />
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const { data: projects = [] } = useListProjects();
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Webhook className="w-7 h-7 text-primary" />
          Webhooks
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect Opsly to external systems. Receive alerts as tasks or push
          events to any URL.
        </p>
      </div>

      <Tabs defaultValue="inbound">
        <TabsList className="mb-4">
          <TabsTrigger value="inbound" className="gap-2">
            <ArrowDownLeft className="w-4 h-4" /> Inbound
          </TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2">
            <ArrowUpRight className="w-4 h-4" /> Outbound
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbound">
          <InboundTab projectOptions={projectOptions} />
        </TabsContent>
        <TabsContent value="outbound">
          <OutboundTab projectOptions={projectOptions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
