import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { useDateLocale } from "@/hooks/use-date-locale";
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
import { useOrgContext } from "@/hooks/use-org-context";
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

const ALL_EVENT_VALUES = [
  "task.created", "task.updated", "task.status_changed", "task.assigned",
  "task.commented", "task.sla_breached", "task.sla_warning", "task.deleted",
  "task.watcher_added", "task.watcher_removed", "project.created",
  "project.updated", "project.deleted", "member.joined", "member.removed",
  "note.created", "note.updated", "note.deleted",
] as const;
type EventValue = (typeof ALL_EVENT_VALUES)[number];

function getEventLabel(value: EventValue, t: (key: string) => string): string {
  return t(`webhooks.event.${value.replace(/\./g, '_')}`);
}

function getVisibilityOptions(t: (key: string) => string): { value: WebhookVisibility; label: string }[] {
  return [
    { value: "private" as WebhookVisibility, label: t('webhooks.visibility.private') },
    { value: "public_read" as WebhookVisibility, label: t('webhooks.visibility.public_read') },
    { value: "public_write" as WebhookVisibility, label: t('webhooks.visibility.public_write_out') },
  ];
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Delivery log ─────────────────────────────────────────────────────────────

function DeliveryRow({ d }: { d: OutboundWebhookDelivery }) {
  const { t, i18n } = useTranslation();
  const dateFnsLocale = useDateLocale();
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
          {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true, locale: dateFnsLocale })}
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
            <span className="font-medium text-foreground/60 w-16 shrink-0">{t('webhooks.deliveryUrl')}</span>
            <code className="truncate">{d.url}</code>
          </div>
          {d.error && (
            <div className="flex gap-2">
              <span className="font-medium text-foreground/60 w-16 shrink-0">{t('webhooks.deliveryError')}</span>
              <span className="text-destructive break-all">{d.error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="font-medium text-foreground/60 w-16 shrink-0">{t('webhooks.deliveryStatus')}</span>
            <span>
              {d.success ? t('webhooks.deliverySuccess') : t('webhooks.deliveryFailed')} · {formatDuration(d.durationMs)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryLogPanel({ webhookId }: { webhookId: number }) {
  const { t } = useTranslation();
  const { data: deliveries, isFetching } = useListOutboundWebhookDeliveries(webhookId);
  return (
    <div className="rounded-md border border-border/50 overflow-hidden bg-card">
      {isFetching && !deliveries ? (
        <p className="text-xs text-muted-foreground text-center py-4">{t('webhooks.deliveryLoading')}</p>
      ) : !deliveries || deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          {t('webhooks.noDeliveries')}
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
  const { t } = useTranslation();
  const ALL_EVENTS = ALL_EVENT_VALUES.map(value => ({ value, label: getEventLabel(value, t) }));
  const VISIBILITY_OPTIONS = getVisibilityOptions(t);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isFeatureEnabled } = useOrgContext();

  const isNew = params.id === "new";
  const hookId = isNew ? null : parseInt(params.id, 10);

  const { data: hooks = [], isLoading: isLoadingList } = useListOutboundWebhooks({
    query: { enabled: isFeatureEnabled("webhooks") },
  });
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
        toast({ title: t('webhooks.outboundCreated', 'Outbound webhook created') });
        setLocation(`/webhooks/outbound/${created.id}`);
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: t('webhooks.updated', 'Webhook updated') });
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: deleteHook, isPending: isDeleting } = useDeleteOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: t('webhooks.deleted', 'Webhook deleted') });
        setLocation("/webhooks");
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
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
      <div className="mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isNew && !existing) {
    return (
      <div className="mx-auto py-16 text-center space-y-4">
        <p className="text-muted-foreground">
          {t('webhooks.notFound', "Webhook not found. It may have been deleted or doesn't belong to your organization.")}
        </p>
        <Button variant="outline" onClick={() => setLocation("/webhooks")}>
          ← {t('webhooks.backToWebhooks', 'Back to Webhooks')}
        </Button>
      </div>
    );
  }

  const readOnly = !isNew && existing ? !existing.isOwner : false;
  const overlaps = getOverlappingPairs(events);

  return (
    <div className="mx-auto space-y-6 pb-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
          onClick={() => setLocation("/webhooks")}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('webhooks.title')}
        </Button>
      </div>

      {/* Page title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {isNew ? t('webhooks.newOutbound', 'New outbound webhook') : (existing?.name ?? t('webhooks.outboundWebhook', 'Outbound webhook'))}
            </h1>
            {existing && (
              <Badge variant="secondary" className="text-xs">{t('webhooks.outboundBadge', 'Outbound')}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {isNew
              ? t('webhooks.outboundNewDesc', 'Opsly will POST signed event payloads to your endpoint when tasks or projects change.')
              : t('webhooks.outboundExistingDesc', 'Opsly POSTs signed event payloads to this endpoint when matching events fire.')}
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
                {t('common.delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('webhooks.deleteWebhookConfirm')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('webhooks.outboundDeleteDesc', 'Opsly will stop sending events to')}{" "}
                  <strong>{existing.url}</strong>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteHook({ id: existing.id })}
                >
                  {t('common.delete')}
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
            {t('webhooks.readOnlyBanner', "You can view this webhook but not edit it — only its owner can make changes.")}
          </span>
        </div>
      )}

      {/* Signing secret — for existing webhooks */}
      {existing && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{t('webhooks.signingSecretLabel')}</Label>
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
                  toast({ title: t('webhooks.copied') });
                }}
                title={t('webhooks.copySigningSecret')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('webhooks.signingInfoPre')}{" "}
              <code className="bg-muted px-1 rounded">X-Opsly-Signature</code>{" "}
              {t('webhooks.signingInfoPost')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Settings form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic settings */}
        <Card>
          <CardContent className="py-5 space-y-5">
            <h2 className="text-sm font-semibold">{t('webhooks.settingsHeading')}</h2>

            <div className="space-y-1.5">
              <Label htmlFor="name">{t('webhooks.nameLabel')}</Label>
              <Input
                id="name"
                placeholder={t('webhooks.egWebhookNameOutbound')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={readOnly || isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-url">{t('webhooks.targetUrlLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="target-url"
                  placeholder={t('webhooks.egTargetUrl')}
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
                    {t('webhooks.sendTest')}
                  </Button>
                )}
              </div>
              {testState.status === "success" && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {testState.statusCode} · {testState.durationMs}ms — {t('webhooks.endpointReachable')}
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
                <Label>{t('webhooks.projectFilterLabel')}</Label>
                <Select
                  value={projectId?.toString() ?? "__none__"}
                  onValueChange={(v) => setProjectId(v === "__none__" ? null : Number(v))}
                  disabled={readOnly || isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('webhooks.noProject')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('webhooks.noProject')}</SelectItem>
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t('webhooks.visibilityLabel')}</Label>
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
              <Label htmlFor="out-enabled">{t('webhooks.enabledLabel')}</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="out-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={readOnly || isPending}
                />
                <span className="text-sm text-muted-foreground">
                  {enabled ? t('webhooks.activeDelivery', 'Active — events will be delivered') : t('webhooks.disabledDelivery', 'Disabled — no events delivered')}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Events */}
        <Card>
          <CardContent className="py-5 space-y-4">
            <h2 className="text-sm font-semibold">{t('webhooks.eventsHeading')}</h2>

            <div className="flex gap-2.5 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-3 py-2.5 text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">{t('webhooks.oneActionMultiple')}</p>
                <p>
                  {t('webhooks.subEventsDescPre')}{" "}
                  <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">
                    task.updated
                  </code>{" "}
                  {t('webhooks.subEventsDescMid')}{" "}
                  <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">
                    task.status_changed
                  </code>
                  {t('webhooks.subEventsDescPost')}
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
                          {t('webhooks.alsoFires')} {EVENT_PARENTS[ev.value]!.join(" / ")}
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
                  <p className="font-medium">{t('webhooks.overlappingEvents')}</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {overlaps.map(([parent, child]) => (
                      <li key={child}>
                        <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                          {parent}
                        </code>{" "}
                        {t('webhooks.alreadyIncludes')}{" "}
                        <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                          {child}
                        </code>{" "}
                        — {t('webhooks.doubleProcessing')}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {t('webhooks.removeSubEvents')}
                  </p>
                </div>
              </div>
            )}

            {events.length === 0 && !readOnly && (
              <p className="text-xs text-destructive">{t('webhooks.selectAtLeastOneEvent', 'Select at least one event.')}</p>
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
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim() || !url.trim() || events.length === 0}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('common.saving')}
                </>
              ) : isNew ? (
                t('webhooks.createWebhook', 'Create webhook')
              ) : (
                t('webhooks.saveChanges', 'Save changes')
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
            <h2 className="text-sm font-semibold">{t('webhooks.recentDeliveries')}</h2>
          </div>
          <DeliveryLogPanel webhookId={existing.id} />
        </div>
      )}
    </div>
  );
}
