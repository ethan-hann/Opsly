import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
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
  useListTaskTemplates,
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
import { useOrgContext } from "@/hooks/use-org-context";
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

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"], label = i18n.t('common.copiedToClipboard')) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast({ title: label });
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

function getVisibilityOptions(t: (key: string) => string): { value: WebhookVisibility; label: string; Icon: typeof Lock }[] {
  return [
    { value: "private" as WebhookVisibility, label: t('webhooks.visibility.private'), Icon: Lock },
    { value: "public_read" as WebhookVisibility, label: t('webhooks.visibility.public_read'), Icon: Eye },
    { value: "public_write" as WebhookVisibility, label: t('webhooks.visibility.public_write_in'), Icon: Globe },
  ];
}

// ─── Payload field reference ──────────────────────────────────────────────────

function getPayloadFields(t: (key: string) => string) {
  return [
    { name: "title",       type: "string",          required: true,  note: t('webhooks.payloadFieldTitleNote') },
    { name: "description", type: "string",          required: false, note: t('webhooks.payloadFieldDescNote') },
    { name: "priority",    type: "string",          required: false, note: t('webhooks.payloadFieldPriorityNote') },
    { name: "category",    type: "string",          required: false, note: t('webhooks.payloadFieldCategoryNote') },
    { name: "status",      type: "string",          required: false, note: t('webhooks.payloadFieldStatusNote') },
    { name: "assignee",    type: "string",          required: false, note: t('webhooks.payloadFieldAssigneeNote') },
    { name: "dueDate",     type: "string | number", required: false, note: t('webhooks.payloadFieldDueDateNote') },
  ];
}

// ─── Template Builder ─────────────────────────────────────────────────────────

type FieldMappingRow = { id: number; key: string; value: string };

function getStaticMappingOptions(t: (key: string) => string): { value: string; label: string; hint: string }[] {
  return [
    { value: "title",       label: t('webhooks.field.title'),       hint: t('webhooks.hintTitle') },
    { value: "description", label: t('webhooks.field.description'), hint: t('webhooks.hintString') },
    { value: "priority",    label: t('webhooks.field.priority'),    hint: t('webhooks.hintPriority') },
    { value: "category",    label: t('webhooks.field.category'),    hint: t('webhooks.hintCategory') },
    { value: "status",      label: t('webhooks.field.status'),      hint: t('webhooks.hintStatus') },
    { value: "assignee",    label: t('webhooks.field.assignee'),    hint: t('webhooks.hintAssignee') },
    { value: "dueDate",     label: t('webhooks.field.dueDate'),     hint: t('webhooks.hintDueDate') },
  ];
}

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
  const { t } = useTranslation();
  const [rows, setRows] = useState<FieldMappingRow[]>(() =>
    Object.entries(template.fieldMapping ?? {}).map(([key, value], id) => ({ id, key, value }))
  );

  function update(patch: Partial<WebhookTaskTemplate>) {
    onChange({ ...template, ...patch });
  }

  const mappingOptions = [
    ...getStaticMappingOptions(t),
    ...(customFieldDefs.length > 0
      ? [
          { value: "__separator__", label: t('webhooks.field.customFields'), hint: "" },
          ...customFieldDefs.map((f) => ({
            value: `cf:${f.id}`,
            label: f.name,
            hint:
              f.type === "multi_select"
                ? t('webhooks.hintMultiSelect')
                : f.type === "single_select"
                ? t('webhooks.hintSingleSelect', { options: (f.options ?? []).join(" · ") || t('webhooks.hintAnyString') })
                : f.type === "number"
                ? t('webhooks.hintNumber')
                : f.type === "date"
                ? t('webhooks.hintDate')
                : t('webhooks.hintText'),
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
        <p className="font-medium text-foreground">{t('webhooks.howMappingWorks')}</p>
        <p>{t('webhooks.howMappingDesc1')}</p>
        <p>{t('webhooks.howMappingDesc2')}</p>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label>{t('webhooks.taskTitleLabel')}</Label>
        <p className="text-xs text-muted-foreground">
          {t('webhooks.taskTitleDesc')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('webhooks.readTitleFrom')}</span>
            <Input
              placeholder={t('webhooks.egAlertname')}
              value={template.titleField ?? ""}
              onChange={(e) => update({ titleField: e.target.value || undefined })}
              className="h-8 text-sm"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('webhooks.fallbackWhenMissing')}</span>
            <Input
              placeholder={t('webhooks.untitledAlert')}
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
        <Label>{t('webhooks.taskDescriptionOptional')}</Label>
        <p className="text-xs text-muted-foreground">
          {t('webhooks.descriptionDesc')}
        </p>
        <Input
          placeholder={t('webhooks.egAnnotationsSummary')}
          value={template.descriptionField ?? ""}
          onChange={(e) => update({ descriptionField: e.target.value || undefined })}
          className="h-8 text-sm"
          disabled={readOnly}
        />
      </div>

      {/* Defaults */}
      <div className="space-y-1.5">
        <Label>{t('webhooks.defaultsLabel')}</Label>
        <p className="text-xs text-muted-foreground">
          {t('webhooks.defaultsDesc')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('webhooks.defaultPriority')}</span>
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
                <SelectValue placeholder={t('webhooks.mediumDefault')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">{t('webhooks.mediumDefault')}</span>
                </SelectItem>
                <SelectItem value="low">{t('tasks.priorityLow')}</SelectItem>
                <SelectItem value="medium">{t('tasks.priorityMedium')}</SelectItem>
                <SelectItem value="high">{t('tasks.priorityHigh')}</SelectItem>
                <SelectItem value="critical">{t('tasks.priorityCritical')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('webhooks.defaultCategory')}</span>
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
                <SelectValue placeholder={t('webhooks.incidentDefault')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">{t('webhooks.incidentDefault')}</span>
                </SelectItem>
                <SelectItem value="incident">{t('tasks.categoryIncident')}</SelectItem>
                <SelectItem value="change">{t('tasks.categoryChange')}</SelectItem>
                <SelectItem value="maintenance">{t('tasks.categoryMaintenance')}</SelectItem>
                <SelectItem value="deployment">{t('tasks.categoryDeployment')}</SelectItem>
                <SelectItem value="support">{t('tasks.categorySupport')}</SelectItem>
                <SelectItem value="other">{t('tasks.categoryOther')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Field remapping */}
      <div className="space-y-2">
        <div className="space-y-1">
          <Label>{t('webhooks.remapFieldsOptional')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('webhooks.remapDesc1')}{" "}
            <code className="bg-muted px-1 rounded">labels.severity</code>{t('webhooks.remapDesc2')}{" "}
            <strong>{t('webhooks.field.priority')}</strong>{t('webhooks.remapDesc3')}
          </p>
        </div>

        {customFieldDefs.length > 0 && (
          <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground leading-relaxed space-y-1">
            <p className="font-medium text-foreground">{t('webhooks.customFieldsCustomize')}</p>
            <p>{t('webhooks.customFieldsPayloadDesc')}</p>
            <p>
              <strong>{t('webhooks.cfTypeTextNumberDate')}</strong> {t('webhooks.cfTypeTextNumberDateDesc')}{" "}
              <code className="bg-background px-1 rounded">{`"env": "production"`}</code>
            </p>
            <p><strong>{t('webhooks.cfTypeSingleSelect')}</strong> {t('webhooks.cfTypeSingleSelectDesc')}</p>
            <p>
              <strong>{t('webhooks.cfTypeMultiSelect')}</strong> {t('webhooks.cfTypeMultiSelectDesc')}{" "}
              <code className="bg-background px-1 rounded">{`"tags": ["API", "P1"]`}</code>
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center">
              <span className="text-xs font-medium text-muted-foreground">{t('webhooks.fromPayloadKey')}</span>
              <span />
              <span className="text-xs font-medium text-muted-foreground">{t('webhooks.mapsToTaskField')}</span>
              <span />
            </div>
            {rows.map((row) => {
              const opt = mappingOptions.find((o) => o.value === row.value);
              const hint = opt && opt.value !== "__separator__" ? opt.hint : undefined;
              return (
                <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center">
                  <Input
                    placeholder={t('webhooks.egLabelsSeverity')}
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
                      <SelectValue placeholder={t('webhooks.chooseField')} />
                    </SelectTrigger>
                    <SelectContent>
                      {mappingOptions.map((o) =>
                        o.value === "__separator__" ? (
                          <div
                            key="separator"
                            className="px-2 py-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider select-none"
                          >
                            {t('webhooks.customFieldsGroup')}
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
            <Plus className="w-3 h-3" /> {t('webhooks.addFieldMapping')}
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
  const { t } = useTranslation();
  const VISIBILITY_OPTIONS = getVisibilityOptions(t);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isFeatureEnabled } = useOrgContext();

  const isNew = params.id === "new";
  const hookId = isNew ? null : parseInt(params.id, 10);

  // Load the list (scoped to the user's org by the server) and find the target hook.
  const { data: hooks = [], isLoading: isLoadingList } = useListInboundWebhooks({
    query: { enabled: isFeatureEnabled("webhooks") },
  });
  const existing: InboundWebhook | undefined = hookId
    ? hooks.find((h) => h.id === hookId)
    : undefined;

  const { data: projects = [] } = useListProjects();
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const { data: allCustomFieldDefs = [] } = useListCustomFieldDefinitions();
  const activeCustomFieldDefs = allCustomFieldDefs.filter((f) => !f.deletedAt);

  const { data: taskTemplates = [] } = useListTaskTemplates();

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
  const [taskTemplateId, setTaskTemplateId] = useState<number | null>(
    existing?.taskTemplateId ?? null
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
      setTaskTemplateId(existing.taskTemplateId ?? null);
      setInitialised(true);
    }
    if (isNew && !initialised) setInitialised(true);
  }, [existing, isNew, initialised]);

  /** When a template is chosen, merge its defaults into the TemplateBuilder state. */
  function applyTaskTemplate(id: number | null) {
    setTaskTemplateId(id);
    if (id === null) return;
    const tmpl = taskTemplates.find((t) => t.id === id);
    if (!tmpl) return;
    setTemplate((prev) => ({
      ...prev,
      ...(tmpl.defaultTitle ? { defaultTitle: tmpl.defaultTitle } : {}),
      ...(tmpl.defaultPriority
        ? { defaultPriority: tmpl.defaultPriority as WebhookTaskTemplate["defaultPriority"] }
        : {}),
      ...(tmpl.defaultCategory
        ? { defaultCategory: tmpl.defaultCategory as WebhookTaskTemplate["defaultCategory"] }
        : {}),
    }));
  }

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
      const msg = e instanceof SyntaxError ? e.message : t('webhooks.invalidJson');
      setJsonError(msg);
      setTestState({ status: "error", error: `${t('webhooks.invalidJson')} — ${msg}` });
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
        toast({ title: t('webhooks.inboundCreated', 'Inbound webhook created') });
        setLocation(`/webhooks/inbound/${created.id}`);
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: update, isPending: isUpdating } = useUpdateInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: t('webhooks.updated', 'Webhook updated') });
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: deleteHook, isPending: isDeleting } = useDeleteInboundWebhook({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        toast({ title: t('webhooks.deleted', 'Webhook deleted') });
        setLocation("/webhooks");
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
    },
  });

  const { mutate: rotate, isPending: isRotating } = useRotateInboundWebhookSecret({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListInboundWebhooksQueryKey() });
        const fullUrl = buildFullIngestUrl(data.ingestUrl);
        navigator.clipboard.writeText(fullUrl).catch(() => {});
        toast({ title: t('webhooks.secretRotated', 'Secret rotated'), description: t('webhooks.secretRotatedDesc', 'New ingest URL copied to clipboard.') });
      },
      onError: (e: Error) =>
        toast({ title: t('common.error'), description: e.message, variant: "destructive" }),
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
      taskTemplateId: taskTemplateId ?? undefined,
      rateLimitPerMinute,
    };
    if (existing) {
      update({ id: existing.id, data: { ...data, projectId: projectId, taskTemplateId: taskTemplateId } });
    } else {
      create({ data });
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  // While the list is loading we can't know if the hook exists yet.
  if (!isNew && isLoadingList) {
    return (
      <div className="mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // List loaded but the hook isn't in it — either wrong org or deleted.
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

  // Non-owner: read-only view.
  const readOnly = !isNew && existing ? !existing.isOwner : false;

  // ── Derived ───────────────────────────────────────────────────────────────
  const fullUrl = existing ? buildFullIngestUrl(existing.ingestUrl) : null;
  const curlCmd = fullUrl ? buildCurlCommand(fullUrl) : null;

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
              {isNew ? t('webhooks.newInbound', 'New inbound webhook') : (existing?.name ?? t('webhooks.inboundWebhook', 'Inbound webhook'))}
            </h1>
            {existing && (
              <Badge variant="secondary" className="text-xs">{t('webhooks.inboundBadge', 'Inbound')}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {isNew
              ? t('webhooks.inboundNewDesc', 'POST any JSON to the generated URL — Opsly creates a task automatically.')
              : t('webhooks.inboundExistingDesc', 'External systems POST JSON to this URL to create tasks automatically.')}
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
                {t('common.delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('webhooks.deleteWebhookConfirm')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('webhooks.inboundDeleteDesc', 'The ingest URL will stop working immediately. Tasks already created by this webhook are kept.')}
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

      {/* Ingest URL card — shown for existing webhooks */}
      {existing && fullUrl && curlCmd && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">{t('webhooks.ingestUrlLabel')}</Label>
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
                        {t('webhooks.rotateSecret', 'Rotate secret')}
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
                        <AlertDialogAction onClick={() => rotate({ id: existing.id })}>
                          {t('webhooks.rotateAndCopy', 'Rotate & copy')}
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
                  title={t('webhooks.copyIngestUrl')}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('webhooks.ingestUrlSecret')}
              </p>
            </div>

            {/* curl example */}
            <div className="space-y-1.5">
              <Label className="text-sm">{t('webhooks.exampleRequest')}</Label>
              <div className="relative">
                <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  {curlCmd}
                </pre>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1.5 right-1.5 h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(curlCmd, toast)}
                  title={t('webhooks.copyCurlCommand')}
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
                {t('webhooks.acceptedPayloadFields')}
              </summary>
              <div className="mt-2">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pr-3 pb-1 font-medium w-24">{t('webhooks.tableField')}</th>
                      <th className="pr-3 pb-1 font-medium w-16">{t('webhooks.tableType')}</th>
                      <th className="pr-3 pb-1 font-medium w-20">{t('webhooks.tableRequired')}</th>
                      <th className="pb-1 font-medium">{t('webhooks.tableNotes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getPayloadFields(t).map((f) => (
                      <tr key={f.name} className="border-t border-border/50">
                        <td className="pr-3 py-1 font-mono text-foreground">{f.name}</td>
                        <td className="pr-3 py-1 text-muted-foreground">{f.type}</td>
                        <td className="pr-3 py-1">
                          {f.required ? (
                            <span className="text-amber-600 font-medium">{t('webhooks.required')}</span>
                          ) : (
                            <span className="text-muted-foreground">{t('webhooks.optional')}</span>
                          )}
                        </td>
                        <td className="py-1 text-muted-foreground leading-relaxed">{f.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2.5 text-xs text-muted-foreground">
                  {t('webhooks.customFieldsRemapNote')}
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
            <h2 className="text-sm font-semibold">{t('webhooks.settingsHeading')}</h2>

            <div className="space-y-1.5">
              <Label htmlFor="name">{t('webhooks.nameLabel')}</Label>
              <Input
                id="name"
                placeholder={t('webhooks.egWebhookName')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={readOnly || isPending}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('webhooks.projectOptionalLabel')}</Label>
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

            {/* Task template picker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{t('webhooks.taskTemplateOptional')}</Label>
                {taskTemplateId !== null &&
                  taskTemplates.some((t) => t.id === taskTemplateId) &&
                  !readOnly && (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      disabled={isPending}
                      onClick={() => {
                        applyTaskTemplate(taskTemplateId);
                        toast({ title: t('webhooks.templateReapplied', 'Template re-applied') });
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      {t('webhooks.reApplyTemplate')}
                    </button>
                  )}
              </div>
              <Select
                value={taskTemplateId?.toString() ?? "__none__"}
                onValueChange={(v) => applyTaskTemplate(v === "__none__" ? null : Number(v))}
                disabled={readOnly || isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('webhooks.noTemplateFill')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('webhooks.noTemplateFill')}</SelectItem>
                  {taskTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {taskTemplateId !== null && (
                <p className="text-xs text-muted-foreground">
                  {t('webhooks.choosingTemplateFills')}
                  {t('webhooks.reApplyTemplateDescPre')} <span className="font-medium text-foreground">{t('webhooks.reApplyTemplate')}</span> {t('webhooks.reApplyTemplateDescPost')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 items-start">
              <div className="space-y-1.5">
                <Label htmlFor="rateLimit">{t('webhooks.rateLimit')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('webhooks.rateLimitDescPre')}{" "}
                  <code className="bg-muted px-1 rounded">429</code> {t('webhooks.rateLimitDescMid')}{" "}
                  <code className="bg-muted px-1 rounded">Retry-After: 60</code> {t('webhooks.rateLimitDescEnd')}
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
                <Label htmlFor="enabled-toggle">{t('webhooks.enabledLabel')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('webhooks.disabledHelp')}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    id="enabled-toggle"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    disabled={readOnly || isPending}
                  />
                  <span className="text-sm">{enabled ? t('common.active') : t('common.disabled')}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Echo warning */}
        <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">{t('webhooks.inboundFiresOutbound')}</p>
            <p>
              {t('webhooks.inboundFiresDesc1')}{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                task.created
              </code>{" "}
              {t('webhooks.inboundFiresDesc2')}
            </p>
          </div>
        </div>

        {/* Payload mapping */}
        <Card>
          <CardContent className="py-5 space-y-5">
            <h2 className="text-sm font-semibold">{t('webhooks.payloadMapping')}</h2>
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
                {t('webhooks.testWithSample')}
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
                  {t('webhooks.testPayloadDesc')}
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
                            err instanceof SyntaxError ? err.message : t('webhooks.invalidJson')
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
                    {t('webhooks.parsePayload')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => setTestPayload(formatJson(testPayload))}
                    disabled={!testPayload.trim() || !!jsonError}
                    title={t('webhooks.formatJson')}
                  >
                    <Braces className="w-3.5 h-3.5" />
                    {t('webhooks.format')}
                  </Button>
                </div>
                {testState.status === "error" && !jsonError && (
                  <p className="text-xs text-destructive">{testState.error}</p>
                )}
                {testState.status === "success" && (
                  <div className="rounded-md border bg-muted/40 divide-y text-xs">
                    {(
                      [
                        [t('webhooks.field.title'), testState.result.title],
                        [t('webhooks.field.priority'), testState.result.priority],
                        [t('webhooks.field.category'), testState.result.category],
                        ...(testState.result.description
                          ? [[t('webhooks.field.description'), testState.result.description]]
                          : []),
                        ...(testState.result.dueDate
                          ? [[t('webhooks.field.dueDate'), testState.result.dueDate]]
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
                      const label = def ? def.name : t('webhooks.customFieldFallback', { id: cfId });
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
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
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
    </div>
  );
}
