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
  getListInboundWebhooksQueryKey,
  getListOutboundWebhooksQueryKey,
} from "@workspace/api-client-react";
import type {
  InboundWebhook,
  OutboundWebhook,
  WebhookTaskTemplate,
  WebhookVisibility,
} from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const VISIBILITY_LABELS: Record<WebhookVisibility, { label: string; Icon: typeof Lock }> = {
  private:      { label: "Private",     Icon: Lock },
  public_read:  { label: "Shared (read-only)", Icon: Eye },
  public_write: { label: "Public",      Icon: Globe },
};

const ALL_EVENTS = [
  { value: "task.created",       label: "Task created" },
  { value: "task.updated",       label: "Task updated" },
  { value: "task.status_changed",label: "Task status changed" },
  { value: "task.assigned",      label: "Task assigned" },
  { value: "task.commented",     label: "Task commented" },
  { value: "project.created",    label: "Project created" },
  { value: "project.updated",    label: "Project updated" },
] as const;

type EventValue = typeof ALL_EVENTS[number]["value"];

function buildFullIngestUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast({ title: "Copied to clipboard" });
}

function VisibilityBadge({ v }: { v: WebhookVisibility }) {
  const { label } = VISIBILITY_LABELS[v] ?? VISIBILITY_LABELS.private;
  return <Badge variant="outline" className="text-xs gap-1">{label}</Badge>;
}

// ─── Task Template Builder ───────────────────────────────────────────────────

type FieldMappingRow = { id: number; key: string; value: string };

interface TemplateBuilderProps {
  template: WebhookTaskTemplate;
  onChange: (t: WebhookTaskTemplate) => void;
}

function TemplateBuilder({ template, onChange }: TemplateBuilderProps) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<FieldMappingRow[]>(() =>
    Object.entries(template.fieldMapping ?? {}).map(([key, value], id) => ({ id, key, value }))
  );

  function update(patch: Partial<WebhookTaskTemplate>) {
    onChange({ ...template, ...patch });
  }

  function syncMapping(r: FieldMappingRow[]) {
    setRows(r);
    const m: Record<string, string> = {};
    r.forEach(({ key, value }) => { if (key && value) m[key] = value; });
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
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Task template
      </button>

      {expanded && (
        <div className="pl-3 border-l border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Title field (payload path)</Label>
              <Input
                placeholder="alertname"
                value={template.titleField ?? ""}
                onChange={(e) => update({ titleField: e.target.value || undefined })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default title (fallback)</Label>
              <Input
                placeholder="Untitled Alert"
                value={template.defaultTitle ?? ""}
                onChange={(e) => update({ defaultTitle: e.target.value || undefined })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description field (payload path)</Label>
              <Input
                placeholder="annotations.summary"
                value={template.descriptionField ?? ""}
                onChange={(e) => update({ descriptionField: e.target.value || undefined })}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Default priority</Label>
              <Select
                value={template.defaultPriority ?? ""}
                onValueChange={(v) => update({ defaultPriority: (v || undefined) as WebhookTaskTemplate["defaultPriority"] })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="medium" />
                </SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "critical"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default category</Label>
              <Select
                value={template.defaultCategory ?? ""}
                onValueChange={(v) => update({ defaultCategory: (v || undefined) as WebhookTaskTemplate["defaultCategory"] })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="incident" />
                </SelectTrigger>
                <SelectContent>
                  {["incident", "change", "maintenance", "deployment", "support", "other"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Field mapping */}
          <div className="space-y-2">
            <Label className="text-xs">Field mapping (payload path → task field)</Label>
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  placeholder="labels.severity"
                  value={row.key}
                  onChange={(e) => updateRow(row.id, "key", e.target.value)}
                  className="h-7 text-xs flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">→</span>
                <Input
                  placeholder="priority"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, "value", e.target.value)}
                  className="h-7 text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-7 text-xs gap-1">
              <Plus className="w-3 h-3" /> Add mapping
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

function InboundDialog({ open, onClose, existing, projectOptions }: InboundDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [projectId, setProjectId] = useState<number | null>(existing?.projectId ?? null);
  const [visibility, setVisibility] = useState<WebhookVisibility>(existing?.visibility ?? "private");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [template, setTemplate] = useState<WebhookTaskTemplate>(existing?.taskTemplate ?? {});

  function reset() {
    setName(existing?.name ?? "");
    setProjectId(existing?.projectId ?? null);
    setVisibility(existing?.visibility ?? "private");
    setEnabled(existing?.enabled ?? true);
    setTemplate(existing?.taskTemplate ?? {});
  }

  function handleClose() { reset(); onClose(); }

  const { mutate: create, isPending: isCreating } = useCreateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Inbound webhook created" });
        handleClose();
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
        handleClose();
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
          <DialogTitle>{existing ? "Edit inbound webhook" : "New inbound webhook"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input placeholder="Datadog alerts" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-1">
            <Label>Project (optional)</Label>
            <Select
              value={projectId?.toString() ?? "__none__"}
              onValueChange={(v) => setProjectId(v === "__none__" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="No project — tasks are unlinked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as WebhookVisibility)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (only me)</SelectItem>
                <SelectItem value="public_read">Shared — org members can view</SelectItem>
                <SelectItem value="public_write">Public — org members can use &amp; view</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="enabled" />
            <Label htmlFor="enabled">Enabled</Label>
          </div>

          <TemplateBuilder template={template} onChange={setTemplate} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Saving…" : existing ? "Save changes" : "Create webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inbound tab ─────────────────────────────────────────────────────────────

function InboundTab({ projectOptions }: { projectOptions: { id: number; name: string }[] }) {
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
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: toggleEnabled } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() }),
    },
  });

  const { mutate: rotate } = useRotateInboundWebhookSecret({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        copyText(buildFullIngestUrl(data.ingestUrl), toast);
        toast({ title: "Secret rotated", description: "New ingest URL copied to clipboard." });
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          External systems POST to an ingest URL; Opsly validates the signature and creates a task.
        </p>
        <Button size="sm" className="gap-2 shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New webhook
        </Button>
      </div>

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowDownLeft className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No inbound webhooks yet.</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Create your first
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => {
            const proj = projectOptions.find((p) => p.id === h.projectId);
            const fullUrl = buildFullIngestUrl(h.ingestUrl);
            return (
              <Card key={h.id} className={h.enabled ? "" : "opacity-60"}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{h.name}</span>
                        <VisibilityBadge v={h.visibility} />
                        {proj && <Badge variant="secondary" className="text-xs">{proj.name}</Badge>}
                        {!h.enabled && <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>}
                      </div>
                      {/* Ingest URL */}
                      <div className="flex items-center gap-2 mt-2">
                        <code className="text-xs bg-muted px-2 py-1 rounded-md truncate max-w-sm">{fullUrl}</code>
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
                      {(h.taskTemplate?.defaultPriority || h.taskTemplate?.defaultCategory || h.taskTemplate?.titleField) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Template: {[
                            h.taskTemplate.titleField && `title from "${h.taskTemplate.titleField}"`,
                            h.taskTemplate.defaultPriority && `${h.taskTemplate.defaultPriority} priority`,
                            h.taskTemplate.defaultCategory && `${h.taskTemplate.defaultCategory} category`,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    {h.isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={h.enabled}
                          onCheckedChange={(v) => toggleEnabled({ id: h.id, data: { enabled: v } })}
                          className="scale-75"
                          title={h.enabled ? "Disable webhook" : "Enable webhook"}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                              title="Rotate secret (invalidates current URL)"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Rotate secret?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The current ingest URL will stop working immediately. Any external system using it
                                must be updated to the new URL. The new URL is automatically copied to your clipboard.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => rotate({ id: h.id })}>Rotate &amp; copy</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                              <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The ingest URL will stop working. Tasks already created by this webhook are kept.
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <InboundDialog open={createOpen} onClose={() => setCreateOpen(false)} projectOptions={projectOptions} />
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

function OutboundDialog({ open, onClose, existing, projectOptions }: OutboundDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [projectId, setProjectId] = useState<number | null>(existing?.projectId ?? null);
  const [events, setEvents] = useState<EventValue[]>((existing?.events as EventValue[]) ?? []);
  const [visibility, setVisibility] = useState<WebhookVisibility>(existing?.visibility ?? "private");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  function reset() {
    setName(existing?.name ?? "");
    setUrl(existing?.url ?? "");
    setProjectId(existing?.projectId ?? null);
    setEvents((existing?.events as EventValue[]) ?? []);
    setVisibility(existing?.visibility ?? "private");
    setEnabled(existing?.enabled ?? true);
  }

  function handleClose() { reset(); onClose(); }

  function toggleEvent(ev: EventValue) {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  }

  const { mutate: create, isPending: isCreating } = useCreateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Outbound webhook created" });
        handleClose();
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
        handleClose();
      },
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
          <DialogTitle>{existing ? "Edit outbound webhook" : "New outbound webhook"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input placeholder="Slack notifications" value={name} onChange={(e) => setName(e.target.value)} required />
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
              Opsly signs each POST with <code>X-Opsly-Signature</code> (HMAC-SHA256).
            </p>
          </div>

          <div className="space-y-1">
            <Label>Project filter (optional)</Label>
            <Select
              value={projectId?.toString() ?? "__none__"}
              onValueChange={(v) => setProjectId(v === "__none__" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All projects</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
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
                      checked ? "border-primary/60 bg-primary/5" : "border-border hover:bg-accent",
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
              <p className="text-xs text-destructive">Select at least one event.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as WebhookVisibility)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (only me)</SelectItem>
                <SelectItem value="public_read">Shared — org members can view</SelectItem>
                <SelectItem value="public_write">Public — org members can view &amp; use</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="out-enabled" />
            <Label htmlFor="out-enabled">Enabled</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name.trim() || !url.trim() || events.length === 0}>
              {isPending ? "Saving…" : existing ? "Save changes" : "Create webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Outbound tab ─────────────────────────────────────────────────────────────

function OutboundTab({ projectOptions }: { projectOptions: { id: number; name: string }[] }) {
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
      onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: toggleEnabled } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Opsly POSTs signed event payloads to your endpoints when tasks or projects change.
        </p>
        <Button size="sm" className="gap-2 shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New webhook
        </Button>
      </div>

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowUpRight className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No outbound webhooks yet.</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
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
                        {proj && <Badge variant="secondary" className="text-xs">{proj.name}</Badge>}
                        {!proj && <Badge variant="outline" className="text-xs text-muted-foreground">All projects</Badge>}
                        {!h.enabled && <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>}
                      </div>
                      {/* Target URL */}
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-muted-foreground truncate max-w-sm">{h.url}</code>
                      </div>
                      {/* Signing secret */}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">Secret:</span>
                        <code className="text-xs bg-muted px-2 py-0.5 rounded-md truncate max-w-[200px]">{h.secret}</code>
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
                          <Badge key={ev} variant="outline" className="text-xs">{ev}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    {h.isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={h.enabled}
                          onCheckedChange={(v) => toggleEnabled({ id: h.id, data: { enabled: v } })}
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
                              <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Opsly will stop sending events to <strong>{h.url}</strong>.
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <OutboundDialog open={createOpen} onClose={() => setCreateOpen(false)} projectOptions={projectOptions} />
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
          Connect Opsly to external systems. Receive alerts as tasks or push events to any URL.
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
