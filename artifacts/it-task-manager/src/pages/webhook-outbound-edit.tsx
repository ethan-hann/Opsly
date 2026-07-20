import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOutboundWebhooks,
  useCreateOutboundWebhook,
  useUpdateOutboundWebhook,
  useDeleteOutboundWebhook,
  useListProjects,
  getListOutboundWebhooksQueryKey,
} from "@workspace/api-client-react";
import type { OutboundWebhook, WebhookVisibility } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Trash2,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Info,
  Lock,
  Eye,
  Globe,
  ShieldAlert,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
} from "lucide-react";
import { useListOutboundWebhookDeliveries } from "@workspace/api-client-react";
import type { OutboundWebhookDelivery } from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const ALL_EVENTS = [
  { value: "task.created", label: "Task created" },
  { value: "task.updated", label: "Task updated" },
  { value: "task.status_changed", label: "Task status changed" },
  { value: "task.assigned", label: "Task assigned" },
  { value: "task.commented", label: "Task commented" },
  { value: "task.sla_breached", label: "Task SLA breached" },
  { value: "task.sla_warning", label: "Task SLA warning (approaching deadline)" },
  { value: "project.created", label: "Project created" },
  { value: "project.updated", label: "Project updated" },
  { value: "note.created", label: "Note created" },
  { value: "note.updated", label: "Note updated" },
  { value: "note.deleted", label: "Note deleted" },
] as const;

type EventValue = (typeof ALL_EVENTS)[number]["value"];

const EVENT_PARENTS: Partial<Record<EventValue, EventValue[]>> = {
  "task.status_changed": ["task.updated"],
  "task.assigned": ["task.updated"],
  "task.commented": ["task.updated"],
  "note.created": ["task.updated", "project.updated"],
  "note.updated": ["task.updated", "project.updated"],
  "note.deleted": ["task.updated", "project.updated"],
};

function getOverlappingPairs(selected: EventValue[]): Array<[EventValue, EventValue]> {
  const pairs: Array<[EventValue, EventValue]> = [];
  for (const ev of selected) {
    const parents = EVENT_PARENTS[ev];
    if (parents) {
      for (const parent of parents) {
        if (selected.includes(parent)) pairs.push([parent, ev]);
      }
    }
  }
  return pairs;
}

const VISIBILITY_OPTIONS: { value: WebhookVisibility; label: string }[] = [
  { value: "private", label: "Private (only me)" },
  { value: "public_read", label: "Shared — org members can view" },
  { value: "public_write", label: "Public — org members can view & use" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Delivery log ─────────────────────────────────────────────────────────────

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
            <span>
              {d.success ? "Success" : "Failed"} · {formatDuration(d.durationMs)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryLogPanel({ webhookId }: { webhookId: number }) {
  const { data: deliveries, isFetching } = useListOutboundWebhookDeliveries(webhookId);
  return (
    <div className="rounded-md border border-border/50 overflow-hidden bg-card">
      {isFetching && !deliveries ? (
        <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
      ) : !deliveries || deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          No deliveries yet. They appear here after the next matching event fires.
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebhookOutboundEditPage({
  params,
}: {
  params: { id: string };
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isNew = params.id === "new";
  const hookId = isNew ? null : parseInt(params.id, 10);

  const { data: hooks = [], isLoading: isLoadingList } = useListOutboundWebhooks();
  const existing: OutboundWebhook | undefined = hookId
    ? hooks.find((h) => h.id === hookId)
    : undefined;

  const { data: projects = [] } = useListProjects();
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  // Form state.
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [projectId, setProjectId] = useState<number | null>(existing?.projectId ?? null);
  const [events, setEvents] = useState<EventValue[]>(
    (existing?.events as EventValue[]) ?? []
  );
  const [visibility, setVisibility] = useState<WebhookVisibility>(
    existing?.visibility ?? "private"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  type TestState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; statusCode: number; durationMs: number }
    | { status: "error"; durationMs: number; error: string; statusCode?: number };
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (existing && !initialised) {
      setName(existing.name);
      setUrl(existing.url);
      setProjectId(existing.projectId ?? null);
      setEvents((existing.events as EventValue[]) ?? []);
      setVisibility(existing.visibility);
      setEnabled(existing.enabled);
      setInitialised(true);
    }
    if (isNew && !initialised) setInitialised(true);
  }, [existing, isNew, initialised]);

  async function handleTest() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setTestState({ status: "loading" });
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/webhooks/outbound/test`.replace(/\/\//g, "/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmedUrl }),
          credentials: "include",
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setTestState({ status: "error", durationMs: 0, error: data.error ?? "Request failed" });
      } else if (data.success) {
        setTestState({ status: "success", statusCode: data.statusCode, durationMs: data.durationMs });
      } else {
        setTestState({
          status: "error",
          durationMs: data.durationMs ?? 0,
          error: data.error ?? `HTTP ${data.statusCode}`,
          statusCode: data.statusCode,
        });
      }
    } catch (err) {
      setTestState({
        status: "error",
        durationMs: 0,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  function toggleEvent(ev: EventValue) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  // Mutations.
  const { mutate: create, isPending: isCreating } = useCreateOutboundWebhook({
    mutation: {
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Outbound webhook created" });
        setLocation(`/webhooks/outbound/${created.id}`);
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Webhook updated" });
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: deleteHook, isPending: isDeleting } = useDeleteOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: "Webhook deleted" });
        setLocation("/webhooks");
      },
      onError: (e: Error) =>
        toast({ title: "Error", description: e.message, variant: "destructive" }),
    },
  });

  const isPending = isCreating || isUpdating || isDeleting;

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

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!isNew && isLoadingList) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

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

  const readOnly = !isNew && existing ? !existing.isOwner : false;
  const overlaps = getOverlappingPairs(events);

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
              {isNew ? "New outbound webhook" : (existing?.name ?? "Outbound webhook")}
            </h1>
            {existing && (
              <Badge variant="secondary" className="text-xs">Outbound</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {isNew
              ? "Opsly will POST signed event payloads to your endpoint when tasks or projects change."
              : "Opsly POSTs signed event payloads to this endpoint when matching events fire."}
          </p>
        </div>

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
                  Opsly will stop sending events to{" "}
                  <strong>{existing.url}</strong>.
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
            You can view this webhook but not edit it — only its owner can make changes.
          </span>
        </div>
      )}

      {/* Signing secret — for existing webhooks */}
      {existing && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Signing secret</Label>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all">
                {existing.secret}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(existing.secret).catch(() => {});
                  toast({ title: "Copied to clipboard" });
                }}
                title="Copy signing secret"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Verify incoming requests by checking the{" "}
              <code className="bg-muted px-1 rounded">X-Opsly-Signature</code> header
              (HMAC-SHA256 of the raw body signed with this secret).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Settings form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic settings */}
        <Card>
          <CardContent className="py-5 space-y-5">
            <h2 className="text-sm font-semibold">Settings</h2>

            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Slack notifications"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={readOnly || isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-url">Target URL</Label>
              <div className="flex gap-2">
                <Input
                  id="target-url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setTestState({ status: "idle" });
                  }}
                  type="url"
                  required
                  disabled={readOnly || isPending}
                  className="flex-1"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    disabled={!url.trim() || testState.status === "loading" || isPending}
                    onClick={handleTest}
                  >
                    {testState.status === "loading" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    )}
                    Send test
                  </Button>
                )}
              </div>
              {testState.status === "success" && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {testState.statusCode} · {testState.durationMs}ms — endpoint reachable
                </p>
              )}
              {testState.status === "error" && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" />
                  {testState.statusCode ? `${testState.statusCode} · ` : ""}
                  {testState.error}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Project filter (optional)</Label>
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

            <div className="space-y-1.5">
              <Label htmlFor="out-enabled">Enabled</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="out-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={readOnly || isPending}
                />
                <span className="text-sm text-muted-foreground">
                  {enabled ? "Active — events will be delivered" : "Disabled — no events delivered"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Events */}
        <Card>
          <CardContent className="py-5 space-y-4">
            <h2 className="text-sm font-semibold">Events</h2>

            <div className="flex gap-2.5 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-3 py-2.5 text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">One action can fire multiple events</p>
                <p>
                  Some events are sub-events of a broader parent. For example,
                  changing a task's status fires both{" "}
                  <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">
                    task.updated
                  </code>{" "}
                  and{" "}
                  <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">
                    task.status_changed
                  </code>
                  . Similarly, note events also fire a parent event. If you subscribe
                  to both a parent and its sub-event, your endpoint will receive two
                  requests for the same action. Select only the broadest event you need.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ALL_EVENTS.map((ev) => {
                const checked = events.includes(ev.value);
                const isChild = ev.value in EVENT_PARENTS;
                return (
                  <label
                    key={ev.value}
                    className={[
                      "flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition-colors",
                      readOnly
                        ? "cursor-default"
                        : "cursor-pointer",
                      checked
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-accent",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => !readOnly && toggleEvent(ev.value)}
                      disabled={readOnly}
                      className="accent-primary"
                    />
                    <span className="flex flex-col min-w-0">
                      <span>{ev.label}</span>
                      {isChild && (
                        <span className="text-[10px] text-muted-foreground font-normal">
                          also fires {EVENT_PARENTS[ev.value]!.join(" / ")}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>

            {/* Overlap warning */}
            {overlaps.length > 0 && (
              <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Overlapping events selected</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {overlaps.map(([parent, child]) => (
                      <li key={child}>
                        <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                          {parent}
                        </code>{" "}
                        already includes{" "}
                        <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                          {child}
                        </code>{" "}
                        — your endpoint will receive two requests per action.
                      </li>
                    ))}
                  </ul>
                  <p>
                    Consider removing the sub-event(s) to avoid double-processing.
                  </p>
                </div>
              </div>
            )}

            {events.length === 0 && !readOnly && (
              <p className="text-xs text-destructive">Select at least one event.</p>
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
            <Button
              type="submit"
              disabled={isPending || !name.trim() || !url.trim() || events.length === 0}
            >
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

      {/* Delivery log — only for existing webhooks */}
      {existing && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Recent deliveries</h2>
          </div>
          <DeliveryLogPanel webhookId={existing.id} />
        </div>
      )}
    </div>
  );
}
