import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useListInboundWebhooks,
  useDeleteInboundWebhook,
  useUpdateInboundWebhook,
  useRotateInboundWebhookSecret,
  useListOutboundWebhooks,
  useDeleteOutboundWebhook,
  useUpdateOutboundWebhook,
  useListOutboundWebhookDeliveries,
  useListProjects,
  getListInboundWebhooksQueryKey,
  getListOutboundWebhooksQueryKey,
} from "@workspace/api-client-react";
import type {
  InboundWebhook,
  OutboundWebhook,
  OutboundWebhookDelivery,
  WebhookVisibility,
} from "@workspace/api-client-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { useOrgContext } from "@/hooks/use-org-context";
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
  AlertTriangle,
  Search,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFullIngestUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"], copiedLabel = i18n.t('common.copiedToClipboard')) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast({ title: copiedLabel });
}

function VisibilityBadge({ v }: { v: WebhookVisibility }) {
  const { t } = useTranslation();
  const labelKey = v === "public_write"
    ? "webhooks.visibility.public_write"
    : v === "public_read"
    ? "webhooks.visibility.public_read"
    : "webhooks.visibility.private";
  return (
    <Badge variant="outline" className="text-xs gap-1">
      {t(labelKey)}
    </Badge>
  );
}

// ─── Delivery Log (collapsed, for list cards) ─────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTimeAgoShort(iso: string, t: (key: string, opts?: any) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('common.justNow');
  if (m < 60) return t('common.minAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('common.hourAgo', { count: h });
  return t('common.dayAgo', { count: Math.floor(h / 24) });
}

function DeliveryRow({ d }: { d: OutboundWebhookDelivery }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
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
          {formatTimeAgoShort(d.createdAt, t)}
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
              {d.success ? t('common.success') : t('common.failed')} · {formatDuration(d.durationMs)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryLogContent({ webhookId }: { webhookId: number }) {
  const { data: deliveries, isFetching } = useListOutboundWebhookDeliveries(webhookId);
  const { t } = useTranslation();
  return (
    <div className="mt-2 rounded-md border border-border/50 overflow-hidden bg-card">
      {isFetching && !deliveries ? (
        <p className="text-xs text-muted-foreground text-center py-4">{t('common.loading')}</p>
      ) : !deliveries || deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
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

function DeliveryLog({ webhookId }: { webhookId: number }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="border-t border-border/40 mt-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Activity className="w-3.5 h-3.5" />
        <span className="font-medium">{t('webhooks.recentDeliveries')}</span>
        <span className="ml-auto">
          {open ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </span>
      </button>
      {open && <DeliveryLogContent webhookId={webhookId} />}
    </div>
  );
}

// ─── Inbound hook card ────────────────────────────────────────────────────────

interface HookActivity {
  tasksLastMinute: number;
  tasksLastHour: number;
}

interface InboundHookCardProps {
  h: InboundWebhook;
  proj: { id: number; name: string } | undefined;
  activity?: HookActivity;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRotate: () => void;
}

function InboundHookCard({
  h,
  proj,
  activity,
  onEdit,
  onDelete,
  onToggle,
  onRotate,
}: InboundHookCardProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [docsOpen, setDocsOpen] = useState(false);
  const fullUrl = buildFullIngestUrl(h.ingestUrl);

  return (
    <Card className={h.enabled ? "" : "opacity-60"}>
      <CardContent className="py-4 space-y-3">
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
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {t('common.disabled')}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <code className="text-xs bg-muted px-2 py-1 rounded-md truncate max-w-sm">
                {fullUrl}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => copyText(fullUrl, toast)}
                title={t('webhooks.copyIngestUrlTitle')}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>

            {h.taskTemplateName && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('webhooks.seededFrom')}{" "}
                <span className="font-medium text-foreground">{h.taskTemplateName}</span>
              </p>
            )}
            {!h.taskTemplateName && (h.taskTemplate?.defaultPriority ||
              h.taskTemplate?.defaultCategory ||
              h.taskTemplate?.titleField) && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('webhooks.templateLabel')}{" "}
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

            <p className="text-xs text-muted-foreground mt-1">
              {t('webhooks.rateLimitLabel')}{" "}
              <span className="font-medium text-foreground">
                {h.rateLimitPerMinute} tasks / min
              </span>
            </p>

            {activity &&
              (activity.tasksLastMinute > 0 || activity.tasksLastHour > 0) &&
              (() => {
                const atLimit =
                  activity.tasksLastMinute >= h.rateLimitPerMinute;
                const highRate =
                  !atLimit &&
                  activity.tasksLastMinute > Math.floor(h.rateLimitPerMinute * 0.5);
                return (
                  <div
                    className={[
                      "flex items-center gap-1.5 text-xs mt-1 font-medium",
                      atLimit
                        ? "text-destructive"
                        : highRate
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground font-normal",
                    ].join(" ")}
                  >
                    {atLimit ? (
                      <>
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                        </span>
                        {t('webhooks.rateLimitHit', { current: activity.tasksLastMinute, max: h.rateLimitPerMinute })}
                      </>
                    ) : highRate ? (
                      <>
                        <Activity className="w-3 h-3 shrink-0" />
                        {t('webhooks.highRate', { count: activity.tasksLastMinute })}
                        {activity.tasksLastHour > activity.tasksLastMinute && (
                          <span className="font-normal text-muted-foreground">
                            · {activity.tasksLastHour} {t('webhooks.inLastHour')}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <Activity className="w-3 h-3 shrink-0" />
                        {activity.tasksLastMinute > 0
                          ? t('webhooks.tasksThisMinute', { count: activity.tasksLastMinute })
                          : t('webhooks.tasksLastHour', { count: activity.tasksLastHour })}
                      </>
                    )}
                  </div>
                );
              })()}

            <button
              type="button"
              onClick={() => setDocsOpen((v) => !v)}
              className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              {t('webhooks.howToSendData')}
              {docsOpen ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>

          {/* Actions — owner only */}
          {h.isOwner && (
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={h.enabled}
                onCheckedChange={onToggle}
                className="scale-75"
                title={h.enabled ? t('webhooks.disableWebhook') : t('webhooks.enableWebhook')}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                    title={t('webhooks.rotateSecretHint')}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('webhooks.rotateSecretConfirm', 'Rotate secret?')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('webhooks.rotateSecretDesc', 'The current ingest URL will stop working immediately. Any external system using it must be updated to the new URL. The new URL is automatically copied to your clipboard.')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={onRotate}>
                      {t('webhooks.rotateAndCopy', 'Rotate & copy')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={onEdit}
                title={t('common.edit')}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('webhooks.deleteWebhookTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('webhooks.deleteInboundDesc')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={onDelete}
                    >
                      {t('common.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        {/* Quick-reference docs */}
        {docsOpen && (
          <div className="border border-border rounded-md bg-muted/30 p-3 space-y-2 text-xs">
            <p className="text-muted-foreground">
              {t('webhooks.howToSendDesc')}
            </p>
            <pre className="bg-muted rounded-md px-3 py-2 font-mono overflow-x-auto whitespace-pre leading-relaxed">
              {`curl -X POST "${fullUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"CPU spike","priority":"high"}'`}
            </pre>
            <p className="text-muted-foreground">
              {t('webhooks.openWebhookRef')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Inbound tab ──────────────────────────────────────────────────────────────

function InboundTab({
  projectOptions,
}: {
  projectOptions: { id: number; name: string }[];
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isFeatureEnabled } = useOrgContext();
  const { data: hooks = [] } = useListInboundWebhooks({
    query: { queryKey: getListInboundWebhooksQueryKey(), enabled: isFeatureEnabled("webhooks") },
  });
  const { data: outboundHooks = [] } = useListOutboundWebhooks({
    query: { queryKey: getListOutboundWebhooksQueryKey(), enabled: isFeatureEnabled("webhooks") },
  });
  const [search, setSearch] = useState("");

  const { data: activity = {} } = useQuery<Record<number, HookActivity>>({
    queryKey: ["webhooks/inbound/activity"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/webhooks/inbound/activity`.replace(/\/\//g, "/"),
        { credentials: "include" },
      );
      return res.ok ? res.json() : {};
    },
    refetchInterval: 30_000,
  });

  const outboundRiskHooks = outboundHooks.filter(
    (oh) => oh.enabled && Array.isArray(oh.events) && oh.events.includes("task.created"),
  );
  const hasEnabledInbound = hooks.some((h) => h.enabled);

  const filtered = search.trim()
    ? hooks.filter((h) => {
        const q = search.toLowerCase();
        const projName =
          projectOptions.find((p) => p.id === h.projectId)?.name ?? "";
        return (
          h.name.toLowerCase().includes(q) || projName.toLowerCase().includes(q)
        );
      })
    : hooks;

  const { mutate: deleteHook } = useDeleteInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: t("webhooks.deleteWebhook") });
      },
      onError: (e: Error) =>
        toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
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
        copyText(buildFullIngestUrl(data.ingestUrl), toast, t("webhooks.copied"));
        toast({ title: t("webhooks.secretKey"), description: t("webhooks.copyUrl") });
      },
      onError: (e: Error) =>
        toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("webhooks.inboundPageDesc")}
        </p>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setLocation("/webhooks/inbound/new")}
        >
          <Plus className="w-4 h-4" /> {t("webhooks.newInbound")}
        </Button>
      </div>

      {outboundRiskHooks.length > 0 && hasEnabledInbound && (
        <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">
              {t("webhooks.loopRiskTitle")}
            </p>
            <p>
              {t("webhooks.loopRiskDesc1")}{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                task.created
              </code>{" "}
              {t("webhooks.loopRiskDesc2")}{" "}
              {outboundRiskHooks.length === 1 ? (
                <span className="font-medium">{outboundRiskHooks[0]!.name}</span>
              ) : (
                outboundRiskHooks.map((oh, i) => (
                  <span key={oh.id}>
                    {i > 0 && (i === outboundRiskHooks.length - 1 ? ` ${t("webhooks.loopRiskAnd")} ` : ", ")}
                    <span className="font-medium">{oh.name}</span>
                  </span>
                ))
              )}{" "}
              {t("webhooks.loopRiskVerb", { count: outboundRiskHooks.length })} {t("webhooks.loopRiskAtSystem")}
            </p>
          </div>
        </div>
      )}

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowDownLeft className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("webhooks.noWebhooks")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/webhooks/inbound/new")}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> {t("webhooks.newInbound")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("webhooks.title")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("common.noResults")}{" "}
              <span className="font-medium">"{search}"</span>.
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((h) => (
                <InboundHookCard
                  key={h.id}
                  h={h}
                  proj={projectOptions.find((p) => p.id === h.projectId)}
                  activity={activity[h.id]}
                  onEdit={() => setLocation(`/webhooks/inbound/${h.id}`)}
                  onDelete={() => deleteHook({ id: h.id })}
                  onToggle={(v) => toggleEnabled({ id: h.id, data: { enabled: v } })}
                  onRotate={() => rotate({ id: h.id })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Outbound tab ─────────────────────────────────────────────────────────────

function OutboundTab({
  projectOptions,
}: {
  projectOptions: { id: number; name: string }[];
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isFeatureEnabled } = useOrgContext();
  const { data: hooks = [] } = useListOutboundWebhooks({
    query: { queryKey: getListOutboundWebhooksQueryKey(), enabled: isFeatureEnabled("webhooks") },
  });
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? hooks.filter((h) => {
        const q = search.toLowerCase();
        const projName =
          projectOptions.find((p) => p.id === h.projectId)?.name ?? "";
        return (
          h.name.toLowerCase().includes(q) ||
          h.url.toLowerCase().includes(q) ||
          projName.toLowerCase().includes(q)
        );
      })
    : hooks;

  const { mutate: deleteHook } = useDeleteOutboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOutboundWebhooksQueryKey() });
        toast({ title: t("webhooks.deleteWebhook") });
      },
      onError: (e: Error) =>
        toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
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
          {t("webhooks.outboundPageDesc")}
        </p>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setLocation("/webhooks/outbound/new")}
        >
          <Plus className="w-4 h-4" /> {t("webhooks.newOutbound")}
        </Button>
      </div>

      {hooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <ArrowUpRight className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("webhooks.noWebhooks")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/webhooks/outbound/new")}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> {t("webhooks.newOutbound")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("webhooks.title")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("common.noResults")}{" "}
              <span className="font-medium">"{search}"</span>.
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((h) => {
                const proj = projectOptions.find((p) => p.id === h.projectId);
                return (
                  <Card key={h.id} className={h.enabled ? "" : "opacity-60"}>
                    <CardContent className="py-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{h.name}</span>
                            <VisibilityBadge v={h.visibility} />
                            {proj ? (
                              <Badge variant="secondary" className="text-xs">
                                {proj.name}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-xs text-muted-foreground"
                              >
                                {t("webhooks.allProjects")}
                              </Badge>
                            )}
                            {!h.enabled && (
                              <Badge
                                variant="outline"
                                className="text-xs text-muted-foreground"
                              >
                                {t("common.disabled")}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs text-muted-foreground truncate max-w-sm">
                              {h.url}
                            </code>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(h.events as string[]).map((ev) => (
                              <Badge key={ev} variant="outline" className="text-xs">
                                {ev}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Actions — owner only */}
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
                              onClick={() => setLocation(`/webhooks/outbound/${h.id}`)}
                              title={t("common.edit")}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  title={t("common.delete")}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("webhooks.deleteWebhookTitle")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("webhooks.deleteOutboundDescPre")}{" "}
                                    <strong>{h.url}</strong>.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => deleteHook({ id: h.id })}
                                  >
                                    {t("common.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </div>

                      <DeliveryLog webhookId={h.id} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const { data: projects = [] } = useListProjects();
  const { t } = useTranslation();
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Webhook className="w-7 h-7 text-primary" />
          {t("webhooks.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("webhooks.pageDesc")}
        </p>
      </div>

      <Tabs defaultValue="inbound">
        <TabsList className="mb-4">
          <TabsTrigger value="inbound" className="gap-2">
            <ArrowDownLeft className="w-4 h-4" /> {t("webhooks.inbound")}
          </TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2">
            <ArrowUpRight className="w-4 h-4" /> {t("webhooks.outbound")}
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
