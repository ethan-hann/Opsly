import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListOrgMembers,
  useListOrgInvitations,
  useInviteOrgMember,
  useCancelOrgInvitation,
  useRemoveOrgMember,
  useUpdateOrgMemberRole,
  useLeaveOrg,
  useRenameOrg,
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useGetSLAPolicies,
  useUpsertSLAPolicies,
  useListTaskTemplates,
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
  useDeleteTaskTemplate,
  useListWorkflowStages,
  useCreateWorkflowStage,
  useUpdateWorkflowStage,
  useRemoveWorkflowStage,
  useReorderWorkflowStages,
  getListWorkflowStagesQueryKey,
  useListApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  getListApiKeysQueryKey,
  usePatchOrgTerminology,
  useUpdateOrgBranding,
  getGetMyOrgQueryKey,
  useGetMyOrg,
} from "@workspace/api-client-react";
import { useTerminology, TERM_DEFAULTS } from "@/context/terminology-context";
import { useBranding, derivePalette } from "@/context/branding-context";
import {
  useReactionPalette,
  usePatchReactionPalette,
  DEFAULT_REACTION_PALETTE,
} from "@/hooks/use-reactions";
import type { TermKey } from "@/context/terminology-context";
import type {
  OrgMemberInfo,
  Role,
  RolePermissions,
  SlaPolicy,
  TaskTemplate,
  WorkflowStage,
  ApiKey,
  ApiKeyScope,
} from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  AlertTriangle,
  Building2,
  Clock,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  Key,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Palette,
  Pencil,
  Plus,
  Settings2,
  Shield,
  Sliders,
  Timer,
  Trash2,
  UserPlus,
  X,
  Workflow,
  Check,
  Eye,
  Users,
  ShieldUser,
  NotepadTextDashed,
  Siren,
  RectangleEllipsis,
  Paintbrush,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { useSseEvent } from "@/hooks/use-sse";
import { CustomFieldsManager } from "@/components/ui/custom-fields-manager";
import { FeatureGate } from "@/components/ui/feature-gate";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { useSearch, useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Branding ─────────────────────────────────────────────────────────────────

/** Detects whether the page is currently in dark mode by watching the <html> class. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(el.classList.contains("dark"));
    });
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Mini preview panel that shows buttons, badges, and an active sidebar item
 *  styled with the draft brand color — updates live as the picker moves. */
const DEFAULT_BRANDING_PRIMARY_COLOR = "#0a7cf5";

function BrandingPreview({ colorHex }: { colorHex: string }) {
  const { t } = useTranslation();
  const isDark = useDarkMode();

  const palette = useMemo(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) return null;
    return derivePalette(colorHex);
  }, [colorHex]);

  if (!palette) return null;

  const p = isDark ? palette.dark : palette.light;

  // Helper: palette values are bare "H S% L%" strings; wrap for CSS
  const c = (v: string) => `hsl(${v})`;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t("orgSettings.branding.livePreview")}
      </p>

      {/* Row 1: primary button + outline button */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium shadow-sm select-none"
          style={{ background: c(p.primary), color: c(p.primaryForeground) }}
        >
          {t("orgSettings.branding.saveButton")}
        </span>
        <span
          className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium select-none"
          style={{
            borderColor: c(p.primary),
            color: c(p.primary),
            background: "transparent",
          }}
        >
          {t("orgSettings.branding.cancelButton")}
        </span>
      </div>

      {/* Row 2: badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold select-none"
          style={{ background: c(p.primary), color: c(p.primaryForeground) }}
        >
          {t("orgSettings.branding.badgeNew")}
        </span>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold select-none"
          style={{ background: c(p.accent), color: c(p.accentForeground) }}
        >
          {t("orgSettings.branding.badgeInProgress")}
        </span>
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold select-none"
          style={{ borderColor: c(p.primary), color: c(p.primary) }}
        >
          {t("orgSettings.branding.badgeOpen")}
        </span>
      </div>

      {/* Row 3: active sidebar item */}
      <div
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium w-fit select-none"
        style={{
          background: c(p.sidebarAccent),
          color: c(p.sidebarAccentForeground),
        }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: c(p.sidebarPrimary) }}
        />
        {t("orgSettings.branding.activeSidebarItem")}
      </div>
    </div>
  );
}

function BrandingCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useOrgContext();
  const canManage = hasPermission("manage_org_settings");

  const { primaryColor: currentPrimaryColor, logoUrl: currentLogoUrl } =
    useBranding();

  const [colorDraft, setColorDraft] = useState(
    currentPrimaryColor ?? DEFAULT_BRANDING_PRIMARY_COLOR,
  );
  const [logoUrlDraft, setLogoUrlDraft] = useState(currentLogoUrl ?? "");

  // Sync drafts when branding loads/changes from server
  useEffect(() => {
    setColorDraft(currentPrimaryColor ?? DEFAULT_BRANDING_PRIMARY_COLOR);
    setLogoUrlDraft(currentLogoUrl ?? "");
  }, [currentPrimaryColor, currentLogoUrl]);

  const { mutate: saveBranding, isPending } = useUpdateOrgBranding({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.branding.brandingSaved") });
        queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() });
      },
      onError: (err: Error) => {
        toast({
          title: t("orgSettings.branding.saveFailed"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSave() {
    const trimmedUrl = logoUrlDraft.trim();
    saveBranding({
      data: {
        primaryColor: colorDraft,
        logoUrl: trimmedUrl || null,
      },
    });
  }

  function handleResetColor() {
    saveBranding(
      { data: { primaryColor: null } },
      {
        onSuccess: () => {
          toast({ title: t("orgSettings.branding.colorResetSuccess") });
          queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() });
          setColorDraft(DEFAULT_BRANDING_PRIMARY_COLOR);
        },
      },
    );
  }

  function handleRemoveLogo() {
    saveBranding(
      { data: { logoUrl: null } },
      {
        onSuccess: () => {
          toast({ title: t("orgSettings.branding.logoRemoved") });
          queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() });
          setLogoUrlDraft("");
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="w-4 h-4" />
          {t("orgSettings.branding.title")}
        </CardTitle>
        <CardDescription>{t("orgSettings.branding.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Primary color */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t("orgSettings.branding.primaryColor")}
          </Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={colorDraft}
              onChange={(e) => setColorDraft(e.target.value)}
              disabled={!canManage || isPending}
              className="w-10 h-10 rounded cursor-pointer border border-border bg-transparent p-0.5 disabled:cursor-not-allowed"
              title={t("orgSettings.branding.pickColor")}
            />
            <code className="text-sm font-mono text-muted-foreground">
              {colorDraft}
            </code>
            {/* Live swatch preview */}
            <div
              className="w-6 h-6 rounded-full border border-border shrink-0"
              style={{ backgroundColor: colorDraft }}
              title={t("orgSettings.branding.colorPreview")}
            />
            {/* Revert to saved color if draft has drifted */}
            {colorDraft !==
              (currentPrimaryColor ?? DEFAULT_BRANDING_PRIMARY_COLOR) && (
              <button
                type="button"
                onClick={() =>
                  setColorDraft(
                    currentPrimaryColor ?? DEFAULT_BRANDING_PRIMARY_COLOR,
                  )
                }
                disabled={isPending}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors disabled:cursor-not-allowed"
                title={t("orgSettings.branding.revertColor")}
              >
                {t("orgSettings.branding.revertColor")}
              </button>
            )}
          </div>
        </div>

        {/* Live theme preview */}
        <BrandingPreview colorHex={colorDraft} />

        {/* Logo URL */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t("orgSettings.branding.logoUrl")}
          </Label>
          <Input
            value={logoUrlDraft}
            onChange={(e) => setLogoUrlDraft(e.target.value)}
            placeholder="https://example.com/logo.png"
            disabled={!canManage || isPending}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {t("orgSettings.branding.logoUrlDesc")}
          </p>
          {logoUrlDraft && (
            <img
              src={logoUrlDraft}
              alt={t("orgSettings.branding.logoAlt")}
              className="h-8 w-auto object-contain rounded border border-border"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
              onLoad={(e) => {
                (e.target as HTMLImageElement).style.display = "";
              }}
            />
          )}
        </div>

        {canManage && (
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending
                ? t("orgSettings.branding.saving")
                : t("orgSettings.branding.saveButton")}
            </Button>
            {currentPrimaryColor && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResetColor}
                disabled={isPending}
              >
                {t("orgSettings.branding.resetColor")}
              </Button>
            )}
            {currentLogoUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemoveLogo}
                disabled={isPending}
              >
                {t("orgSettings.branding.removeLogo")}
              </Button>
            )}
          </div>
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            {t("orgSettings.branding.noPermission")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Reaction Palette ─────────────────────────────────────────────────────────

function ReactionPaletteCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission } = useOrgContext();
  const canManage = hasPermission("manage_reactions");

  const { data: paletteData, isLoading } = useReactionPalette();
  const { mutate: savePalette, isPending: isSaving } =
    usePatchReactionPalette();

  const [input, setInput] = useState("");
  const [localPalette, setLocalPalette] = useState<string[]>([]);

  // Sync local state when palette loads
  useEffect(() => {
    if (paletteData?.palette) {
      setLocalPalette(paletteData.palette);
    }
  }, [paletteData?.palette]);

  function handleAdd() {
    const emoji = input.trim();
    if (!emoji) return;
    if (localPalette.includes(emoji)) {
      toast({
        title: t("orgSettings.reactions.emojiAlreadyExists"),
        variant: "destructive",
      });
      return;
    }
    setLocalPalette((prev) => [...prev, emoji]);
    setInput("");
  }

  function handleRemove(emoji: string) {
    setLocalPalette((prev) => prev.filter((e) => e !== emoji));
  }

  function handleSave() {
    if (localPalette.length === 0) {
      toast({
        title: t("orgSettings.reactions.mustHaveOne"),
        variant: "destructive",
      });
      return;
    }
    savePalette(
      { palette: localPalette },
      {
        onSuccess: () =>
          toast({ title: t("orgSettings.reactions.paletteSaved") }),
        onError: (err: Error) =>
          toast({
            title: t("common.error"),
            description: err.message,
            variant: "destructive",
          }),
      },
    );
  }

  const isDefault =
    localPalette.length === DEFAULT_REACTION_PALETTE.length &&
    DEFAULT_REACTION_PALETTE.every(
      (e: string, i: number) => localPalette[i] === e,
    );

  function handleReset() {
    savePalette(
      { palette: DEFAULT_REACTION_PALETTE },
      {
        onSuccess: () => {
          setLocalPalette(DEFAULT_REACTION_PALETTE);
          toast({ title: t("orgSettings.reactions.paletteReset") });
        },
        onError: (err: Error) =>
          toast({
            title: t("common.error"),
            description: err.message,
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span role="img" aria-label="reactions">
            😊
          </span>
          {t("orgSettings.reactions.title")}
        </CardTitle>
        <CardDescription>{t("orgSettings.reactions.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {localPalette.map((emoji) => (
              <div
                key={emoji}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-sm"
              >
                <span>{emoji}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRemove(emoji)}
                    disabled={isSaving}
                    className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                    aria-label={`Remove ${emoji}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {localPalette.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                {t("orgSettings.reactions.emptyPalette")}
              </p>
            )}
          </div>
        )}

        {canManage && (
          <>
            <div className="flex gap-2 items-center">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={t("orgSettings.reactions.emojiPlaceholder")}
                className="h-8 text-sm w-40"
                maxLength={16}
                disabled={isSaving}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAdd}
                disabled={isSaving || !input.trim()}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {t("orgSettings.reactions.addEmoji")}
              </Button>
            </div>
            <div className="flex gap-2 pt-1 flex-wrap">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || localPalette.length === 0}
              >
                {isSaving
                  ? t("common.saving")
                  : t("orgSettings.reactions.savePalette")}
              </Button>
              {!isDefault && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  disabled={isSaving}
                  title={t("orgSettings.reactions.restoreDefaultsTitle")}
                >
                  {t("orgSettings.reactions.resetToDefaults")}
                </Button>
              )}
            </div>
          </>
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            {t("orgSettings.reactions.noPermission")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Terminology ──────────────────────────────────────────────────────────────

const TERMINOLOGY_KEY_LABELS: Record<
  TermKey,
  { label: string; description: string }
> = {
  projects: {
    label: "Projects",
    description: "E.g. Services, Initiatives, Epics",
  },
  tasks: { label: "Tasks", description: "E.g. Tickets, Issues, Requests" },
  members: { label: "Members", description: "E.g. Agents, Users, Staff" },
  workflows: { label: "Workflows", description: "E.g. Pipelines, Processes" },
  stages: { label: "Stages", description: "E.g. Steps, Statuses, Phases" },
};

const SINGULAR_DRAFT_KEYS = [
  "projectsSingular",
  "tasksSingular",
  "membersSingular",
  "workflowsSingular",
  "stagesSingular",
] as const;
type SingularDraftKey = (typeof SINGULAR_DRAFT_KEYS)[number];

function TerminologyCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useOrgContext();
  const canManageTerminology = hasPermission("manage_terminology");
  const { terminology } = useTerminology();
  // useGetMyOrg is already cached by OrgGuard — no extra network round-trip.
  const { data: orgData } = useGetMyOrg();
  const rawTerminology = orgData?.terminology;

  // Local draft state — one entry per term key
  const [draft, setDraft] = useState<Record<TermKey, string>>(() => ({
    projects: terminology.projects,
    tasks: terminology.tasks,
    members: terminology.members,
    workflows: terminology.workflows,
    stages: terminology.stages,
  }));

  // Singular override drafts — empty string means "let the app auto-derive"
  const [draftSingular, setDraftSingular] = useState<
    Record<SingularDraftKey, string>
  >(() => ({
    projectsSingular: rawTerminology?.projectsSingular ?? "",
    tasksSingular: rawTerminology?.tasksSingular ?? "",
    membersSingular: rawTerminology?.membersSingular ?? "",
    workflowsSingular: rawTerminology?.workflowsSingular ?? "",
    stagesSingular: rawTerminology?.stagesSingular ?? "",
  }));

  // Keep drafts in sync when the org's terminology changes (e.g. after save)
  useEffect(() => {
    setDraft({
      projects: terminology.projects,
      tasks: terminology.tasks,
      members: terminology.members,
      workflows: terminology.workflows,
      stages: terminology.stages,
    });
  }, [
    terminology.projects,
    terminology.tasks,
    terminology.members,
    terminology.workflows,
    terminology.stages,
  ]);

  useEffect(() => {
    setDraftSingular({
      projectsSingular: rawTerminology?.projectsSingular ?? "",
      tasksSingular: rawTerminology?.tasksSingular ?? "",
      membersSingular: rawTerminology?.membersSingular ?? "",
      workflowsSingular: rawTerminology?.workflowsSingular ?? "",
      stagesSingular: rawTerminology?.stagesSingular ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rawTerminology?.projectsSingular,
    rawTerminology?.tasksSingular,
    rawTerminology?.membersSingular,
    rawTerminology?.workflowsSingular,
    rawTerminology?.stagesSingular,
  ]);

  const { mutate: patch, isPending } = usePatchOrgTerminology({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.terminology.saved") });
        // Invalidate /orgs/me so nav labels update on next render
        queryClient.invalidateQueries({ queryKey: getGetMyOrgQueryKey() });
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSave() {
    // Build plural payload — always send all five so the backend can persist resets
    const payload: Record<string, string | null> = (
      Object.keys(draft) as TermKey[]
    ).reduce(
      (acc, key) => {
        acc[key] = draft[key].trim() || TERM_DEFAULTS[key];
        return acc;
      },
      {} as Record<string, string | null>,
    );
    // Include singular overrides: non-empty value → upsert, empty string → null to clear the DB row
    SINGULAR_DRAFT_KEYS.forEach((singularKey) => {
      const val = draftSingular[singularKey].trim();
      payload[singularKey] = val || null;
    });
    patch({ data: payload });
  }

  // Derive singular placeholder (auto-derived form) for each key
  function autoSingular(key: TermKey): string {
    const label = draft[key].trim() || TERM_DEFAULTS[key];
    if (label.endsWith("ies")) return label.slice(0, -3) + "y";
    if (/(?:s|z|ch|sh)es$/.test(label)) return label.slice(0, -2);
    if (label.endsWith("s")) return label.slice(0, -1);
    return label;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          {t("orgSettings.terminology.title")}
        </CardTitle>
        <CardDescription>{t("orgSettings.terminology.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {(Object.keys(TERMINOLOGY_KEY_LABELS) as TermKey[]).map((key) => {
            const meta = TERMINOLOGY_KEY_LABELS[key];
            const singularKey = `${key}Singular` as SingularDraftKey;
            return (
              <div key={key} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {meta.label}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("orgSettings.terminology.pluralLabel")}
                    </span>
                    <span className="ml-1.5 text-muted-foreground font-normal">
                      {t("orgSettings.terminology.defaultLabel", {
                        value: TERM_DEFAULTS[key],
                      })}
                    </span>
                  </Label>
                  <Input
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={meta.description}
                    disabled={!canManageTerminology || isPending}
                    maxLength={50}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("orgSettings.terminology.singular")}
                  </Label>
                  <Input
                    value={draftSingular[singularKey]}
                    onChange={(e) =>
                      setDraftSingular((prev) => ({
                        ...prev,
                        [singularKey]: e.target.value,
                      }))
                    }
                    placeholder={`e.g. "${autoSingular(key)}"`}
                    disabled={!canManageTerminology || isPending}
                    maxLength={50}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>
        {canManageTerminology && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending
                ? t("common.saving")
                : t("orgSettings.terminology.saveButton")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setDraft({
                  projects: TERM_DEFAULTS.projects,
                  tasks: TERM_DEFAULTS.tasks,
                  members: TERM_DEFAULTS.members,
                  workflows: TERM_DEFAULTS.workflows,
                  stages: TERM_DEFAULTS.stages,
                });
                setDraftSingular({
                  projectsSingular: "",
                  tasksSingular: "",
                  membersSingular: "",
                  workflowsSingular: "",
                  stagesSingular: "",
                });
              }}
            >
              {t("orgSettings.terminology.resetToDefaults")}
            </Button>
          </div>
        )}
        {!canManageTerminology && (
          <p className="text-xs text-muted-foreground">
            {t("orgSettings.terminology.noPermission")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

const ALL_SCOPES: ApiKeyScope[] = [
  "tasks:read",
  "tasks:write",
  "projects:read",
  "projects:write",
  "comments:read",
  "comments:write",
  "webhooks:read",
  "webhooks:write",
];

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "tasks:read": "Tasks — read",
  "tasks:write": "Tasks — write",
  "projects:read": "Projects — read",
  "projects:write": "Projects — write",
  "comments:read": "Comments — read",
  "comments:write": "Comments — write",
  "webhooks:read": "Webhooks — read",
  "webhooks:write": "Webhooks — write",
};

function formatKeyExpiry(
  t: (k: string, opts?: Record<string, unknown>) => string,
  key: ApiKey,
  locale?: string,
): string {
  if (key.revokedAt) return t("orgSettings.apiKeys.revoked");
  if (key.isExpired) return t("orgSettings.apiKeys.expired");
  if (!key.expiresAt) return t("orgSettings.apiKeys.neverExpires");
  return t("orgSettings.apiKeys.expiresOn", {
    date: new Date(key.expiresAt).toLocaleDateString(locale || undefined),
  });
}

function ApiKeyRow({
  apiKey,
  onRevoked,
}: {
  apiKey: ApiKey;
  onRevoked: () => void;
}) {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const { mutate: revoke, isPending: isRevoking } = useRevokeApiKey({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.apiKeys.keyRevoked") });
        onRevoked();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const isActive = !apiKey.revokedAt && !apiKey.isExpired;
  const creatorName = apiKey.createdBy
    ? [apiKey.createdBy.firstName, apiKey.createdBy.lastName]
        .filter(Boolean)
        .join(" ") ||
      apiKey.createdBy.email ||
      t("common.unknown")
    : t("common.unknown");

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${isActive ? "border-border bg-card" : "border-border/50 bg-muted/30"}`}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`font-medium text-sm ${!isActive ? "text-muted-foreground" : ""}`}
          >
            {apiKey.name}
          </span>
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
            {apiKey.keyPrefix}…
          </code>
          {apiKey.revokedAt ? (
            <Badge variant="destructive" className="text-xs py-0">
              {t("orgSettings.apiKeys.revoked")}
            </Badge>
          ) : apiKey.isExpired ? (
            <Badge
              variant="outline"
              className="text-xs py-0 text-muted-foreground"
            >
              {t("orgSettings.apiKeys.expired")}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs py-0">
              {t("common.active")}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {apiKey.scopes.map((s) => (
            <Badge key={s} variant="outline" className="text-xs py-0 font-mono">
              {s}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatKeyExpiry(t, apiKey, i18n.language)} ·{" "}
          {t("orgSettings.apiKeys.createdBy", {
            name: creatorName,
            date: new Date(apiKey.createdAt).toLocaleDateString(
              i18n.language || undefined,
            ),
          })}
        </p>
      </div>
      {isActive && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
              disabled={isRevoking}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("orgSettings.apiKeys.revokeKey")} "{apiKey.name}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("orgSettings.apiKeys.revokeKeyDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => revoke({ id: apiKey.id })}
              >
                {t("orgSettings.apiKeys.revokeKey")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

interface CreateKeyFormState {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt: string;
}

function ApiKeysCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<CreateKeyFormState>({
    name: "",
    scopes: [],
    expiresAt: "",
  });

  const { data: keys = [], refetch: refetchKeys } = useListApiKeys();

  const { mutate: createKey, isPending: isSubmitting } = useCreateApiKey({
    mutation: {
      onSuccess: (data) => {
        setRevealedKey(data.key);
        setIsCreating(false);
        setForm({ name: "", scopes: [], expiresAt: "" });
        queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function toggleScope(scope: ApiKeyScope) {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || form.scopes.length === 0) return;
    createKey({
      data: {
        name: form.name.trim(),
        scopes: form.scopes,
        ...(form.expiresAt
          ? { expiresAt: new Date(form.expiresAt).toISOString() }
          : {}),
      },
    });
  }

  function handleCopy() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const activeKeys = keys.filter((k) => !k.revokedAt && !k.isExpired);
  const inactiveKeys = keys.filter((k) => k.revokedAt || k.isExpired);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="w-4 h-4" />
              {t("orgSettings.apiKeys.title")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("orgSettings.apiKeys.desc")}
            </CardDescription>
          </div>
          {!isCreating && !revealedKey && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              {t("orgSettings.apiKeys.newKey")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* One-time reveal modal */}
        {revealedKey && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Eye className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t("orgSettings.apiKeys.copyKeyNow")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("orgSettings.apiKeys.copyKeyDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all select-all">
                {revealedKey}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied
                  ? t("orgSettings.apiKeys.copied")
                  : t("orgSettings.apiKeys.copy")}
              </Button>
            </div>
            <Button
              size="sm"
              variant="default"
              className="w-full"
              onClick={() => {
                setRevealedKey(null);
                setCopied(false);
                refetchKeys();
              }}
            >
              {t("orgSettings.apiKeys.savedKey")}
            </Button>
          </div>
        )}

        {/* Create form */}
        {isCreating && (
          <form
            onSubmit={handleCreate}
            className="space-y-4 p-4 rounded-lg border border-primary/30 bg-primary/5"
          >
            <div className="space-y-1">
              <Label className="text-xs">
                {t("orgSettings.apiKeys.keyName")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t("orgSettings.apiKeys.keyNamePlaceholder")}
                maxLength={200}
                autoFocus
                className="h-8 text-sm"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("orgSettings.apiKeys.scopes")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {ALL_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Switch
                      id={`scope-${scope}`}
                      checked={form.scopes.includes(scope)}
                      onCheckedChange={() => toggleScope(scope)}
                      disabled={isSubmitting}
                      className="h-4 w-7 data-[state=checked]:bg-primary"
                    />
                    <Label
                      htmlFor={`scope-${scope}`}
                      className="text-xs text-muted-foreground cursor-pointer font-mono"
                    >
                      {scope}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {t("orgSettings.apiKeys.expiryDate")}
              </Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresAt: e.target.value }))
                }
                className="h-8 text-sm"
                disabled={isSubmitting}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={
                  isSubmitting || !form.name.trim() || form.scopes.length === 0
                }
              >
                {isSubmitting
                  ? t("common.saving")
                  : t("orgSettings.apiKeys.createKey")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isSubmitting}
                onClick={() => {
                  setIsCreating(false);
                  setForm({ name: "", scopes: [], expiresAt: "" });
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}

        {/* Active keys */}
        {activeKeys.length === 0 && !isCreating && !revealedKey && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("orgSettings.apiKeys.noActiveKeys")}
          </p>
        )}
        {activeKeys.map((k) => (
          <ApiKeyRow key={k.id} apiKey={k} onRevoked={() => refetchKeys()} />
        ))}

        {/* Revoked / expired (collapsed) */}
        {inactiveKeys.length > 0 && (
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1 select-none">
              <span className="group-open:hidden">▶</span>
              <span className="hidden group-open:inline">▼</span>
              Show {inactiveKeys.length} inactive key
              {inactiveKeys.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 space-y-2">
              {inactiveKeys.map((k) => (
                <ApiKeyRow
                  key={k.id}
                  apiKey={k}
                  onRevoked={() => refetchKeys()}
                />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ExportCard ─────────────────────────────────────────────────────────────
// Exported for unit-testing the SSE live-update path.

function getExportScopeOptions(t: (key: string) => string) {
  return [
    { value: "tasks" as const, label: t("orgSettings.exportScopeTasks") },
    { value: "comments" as const, label: t("orgSettings.exportScopeComments") },
    { value: "projects" as const, label: t("orgSettings.exportScopeProjects") },
    { value: "notes" as const, label: t("orgSettings.exportScopeNotes") },
  ];
}
type ExportScopeValue = "tasks" | "comments" | "projects" | "notes";

interface PendingExport {
  token: string;
  filename: string;
  expiresAt: string;
}

export function ExportCard() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  const [scope, setScope] = useState<ExportScopeValue[]>([
    "tasks",
    "comments",
    "projects",
    "notes",
  ]);
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [isExporting, setIsExporting] = useState(false);
  const [jobQueued, setJobQueued] = useState(false);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(
    null,
  );
  const [exportExpired, setExportExpired] = useState(false);

  // Check for a completed or in-progress background export on mount.
  // When a job is still processing (jobInProgress: true) the button is
  // disabled so the user cannot queue a duplicate — the guard is then
  // restored by the export_ready SSE notification just as it would be
  // after the original click.
  useEffect(() => {
    fetch(`${BASE}/api/export/pending`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            pending: boolean;
            jobInProgress?: boolean;
            token?: string;
            filename?: string;
            expiresAt?: string;
          } | null,
        ) => {
          if (data?.jobInProgress) {
            setJobQueued(true);
            return;
          }
          if (data?.pending && data.token && data.filename && data.expiresAt) {
            setPendingExport({
              token: data.token,
              filename: data.filename,
              expiresAt: data.expiresAt,
            });
          }
        },
      )
      .catch(() => {});
  }, [BASE]);

  // Listen for export_ready notifications on the shared SSE stream so the
  // download banner appears automatically without a full page refresh.
  const handleExportReadyNotification = useCallback(
    (raw: unknown) => {
      const data = raw as { type?: string };
      if (data.type !== "export_ready") return;
      fetch(`${BASE}/api/export/pending`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            res: {
              pending: boolean;
              token?: string;
              filename?: string;
              expiresAt?: string;
            } | null,
          ) => {
            if (res?.pending && res.token && res.filename && res.expiresAt) {
              setPendingExport({
                token: res.token,
                filename: res.filename,
                expiresAt: res.expiresAt,
              });
              setJobQueued(false);
            }
          },
        )
        .catch(() => {});
    },
    [BASE],
  );
  useSseEvent("notification", handleExportReadyNotification);

  function toggleScope(value: ExportScopeValue) {
    setScope((s) =>
      s.includes(value) ? s.filter((v) => v !== value) : [...s, value],
    );
  }

  async function triggerDownload(token: string) {
    const res = await fetch(`${BASE}/api/export/download/${token}`, {
      credentials: "include",
    });
    if (!res.ok) {
      setPendingExport(null);
      setExportExpired(true);
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? "export";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    if (scope.length === 0) return;
    setIsExporting(true);
    setJobQueued(false);
    try {
      const res = await fetch(`${BASE}/api/export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, format }),
      });

      if (res.status === 202) {
        // Large org — background job queued.
        setJobQueued(true);
        toast({
          title: t("orgSettings.export.queued"),
          description: t("orgSettings.export.queuedDesc"),
        });
      } else if (res.ok) {
        // Small org — stream directly.
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition") ?? "";
        const match = cd.match(/filename="([^"]+)"/);
        const filename =
          match?.[1] ?? `export.${format === "csv" ? "zip" : "json"}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: t("orgSettings.export.success") });
      } else {
        const body = await res.json().catch(() => ({ error: "Export failed" }));
        toast({
          title: t("orgSettings.export.failed"),
          description: (body as { error?: string }).error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: t("orgSettings.export.failed"),
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="w-4 h-4" />
          {t("orgSettings.export.title")}
        </CardTitle>
        <CardDescription>{t("orgSettings.export.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Export expired banner */}
        {exportExpired && !pendingExport && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <Download className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm font-medium text-destructive">
                {t("orgSettings.export.expired")}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  setExportExpired(false);
                  handleExport();
                }}
                disabled={isExporting || scope.length === 0}
              >
                <Download className="w-3.5 h-3.5" />
                {t("orgSettings.export.startExport")}
              </Button>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExportExpired(false)}
              aria-label={t("notifications.dismiss")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Pending background export ready banner */}
        {pendingExport && !exportExpired && (
          <div className="flex items-start gap-3 rounded-lg border border-green-500/40 bg-green-500/5 p-4">
            <Download className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  {t("orgSettings.export.ready")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("orgSettings.export.availableUntil")}{" "}
                  {new Date(pendingExport.expiresAt).toLocaleString(
                    i18n.language || undefined,
                  )}
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => triggerDownload(pendingExport.token)}
              >
                <Download className="w-3.5 h-3.5" />
                {t("orgSettings.export.download")} {pendingExport.filename}
              </Button>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setPendingExport(null)}
              aria-label={t("notifications.dismiss")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Scope selection */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("orgSettings.export.include")}
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {getExportScopeOptions(t).map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <Switch
                  id={`export-scope-${opt.value}`}
                  checked={scope.includes(opt.value)}
                  onCheckedChange={() => toggleScope(opt.value)}
                  disabled={isExporting}
                  className="h-4 w-7 data-[state=checked]:bg-primary"
                />
                <Label
                  htmlFor={`export-scope-${opt.value}`}
                  className="text-sm cursor-pointer"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Format selection */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("orgSettings.export.format")}
          </Label>
          <div className="flex flex-col gap-2">
            {(["json", "csv"] as const).map((fmt) => (
              <label
                key={fmt}
                className="flex items-start gap-2.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name="export-format"
                  value={fmt}
                  checked={format === fmt}
                  onChange={() => setFormat(fmt)}
                  disabled={isExporting}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  {fmt === "json" ? (
                    <>
                      <span className="font-medium">JSON</span>
                      <span className="text-muted-foreground">
                        {" "}
                        {t("orgSettings.export.jsonDesc")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">CSV</span>
                      <span className="text-muted-foreground">
                        {" "}
                        {t("orgSettings.export.csvDesc")}
                      </span>
                    </>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Job queued notice */}
        {jobQueued && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            {t("orgSettings.export.preparing")}
          </div>
        )}

        <Button
          onClick={handleExport}
          disabled={isExporting || jobQueued || scope.length === 0}
          className="gap-2"
          title={
            jobQueued ? t("orgSettings.export.exportQueuedHint") : undefined
          }
        >
          {isExporting || jobQueued ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {isExporting
            ? t("orgSettings.export.preparing")
            : jobQueued
              ? t("orgSettings.export.inProgress")
              : t("orgSettings.export.downloadExport")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Permission metadata ──────────────────────────────────────────────────────

type PermKey = keyof RolePermissions;

interface PermGroup {
  labelKey: string;
  keys: PermKey[];
  /** When set, this group is only shown when the given feature is enabled. */
  featureGate?: string;
  /** Per-key feature gates: a key is hidden when its feature is disabled. */
  keyGates?: Partial<Record<PermKey, string>>;
}

const PERM_GROUPS: PermGroup[] = [
  {
    labelKey: "orgSettings.permissions.tasks",
    keys: [
      "view_tasks",
      "create_tasks",
      "edit_tasks",
      "close_tasks",
      "delete_tasks",
      "delete_comments",
      "edit_comments",
    ],
  },
  {
    labelKey: "orgSettings.permissions.projectsOrg",
    keys: ["manage_projects", "manage_org_settings", "manage_members"],
  },
  {
    labelKey: "orgSettings.permissions.features",
    keys: [
      "manage_webhooks",
      "manage_api_keys",
      "manage_custom_fields",
      "manage_workflow_stages",
      "manage_sla_policies",
      "manage_task_templates",
      "manage_saved_views",
      "view_audit_log",
      "manage_terminology",
      "manage_reactions",
      "link_tasks",
    ],
    keyGates: {
      manage_webhooks: "webhooks",
      manage_api_keys: "api_keys",
      manage_custom_fields: "custom_fields",
      manage_workflow_stages: "custom_statuses",
      manage_sla_policies: "sla_tracking",
      link_tasks: "task_trees",
    },
  },
];

function getPermLabels(t: (k: string, opts?: Record<string, string>) => string, task: string, tasks: string): Record<PermKey, string> {
  return {
    view_tasks: t("orgSettings.permissions.viewTasks"),
    create_tasks: t("orgSettings.permissions.createTasks"),
    edit_tasks: t("orgSettings.permissions.editTasks"),
    close_tasks: t("orgSettings.permissions.closeTasks"),
    delete_tasks: t("orgSettings.permissions.deleteTasks"),
    delete_comments: t("orgSettings.permissions.deleteComments"),
    edit_comments: t("orgSettings.permissions.editComments"),
    manage_projects: t("orgSettings.permissions.manageProjects"),
    manage_org_settings: t("orgSettings.permissions.manageOrgSettings"),
    manage_members: t("orgSettings.permissions.manageMembers"),
    manage_webhooks: t("orgSettings.permissions.manageWebhooks"),
    manage_api_keys: t("orgSettings.permissions.manageApiKeys"),
    manage_custom_fields: t("orgSettings.permissions.manageCustomFields"),
    manage_workflow_stages: t("orgSettings.permissions.manageWorkflowStages"),
    manage_sla_policies: t("orgSettings.permissions.manageSla"),
    manage_task_templates: t("orgSettings.permissions.manageTemplates"),
    manage_saved_views: t("orgSettings.permissions.manageSavedViews"),
    view_audit_log: t("orgSettings.permissions.viewAuditLog"),
    manage_terminology: t("orgSettings.permissions.manageTerminology"),
    manage_reactions: t("orgSettings.permissions.manageReactions"),
    link_tasks: t("orgSettings.permissions.linkTasks", { task, tasks }),
  };
}

// All permission keys in PERM_GROUPS order — used to build blank permission sets.
const ALL_PERM_KEYS: PermKey[] = PERM_GROUPS.flatMap((g: PermGroup) => g.keys);

// Starting state for a fresh custom role: every permission off.
// The API merges over MEMBER_PERMISSIONS when permissions are omitted, but since
// we always send an explicit object, the sent value is used as-is.
const BLANK_PERMISSIONS: RolePermissions = Object.fromEntries(
  ALL_PERM_KEYS.map((k) => [k, false]),
) as unknown as RolePermissions;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInviteLink(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}invite/${token}`;
}

function roleBadgeVariant(
  roleName: string,
): "default" | "secondary" | "outline" {
  if (roleName === "Owner") return "default";
  if (roleName === "Admin") return "secondary";
  return "outline";
}

// ─── LeaveOrgSection ─────────────────────────────────────────────────────────

interface LeaveOrgSectionProps {
  orgName: string;
  isOwner: boolean;
  isOnlyMember: boolean;
  isLeaving: boolean;
  onLeave: () => void;
}

function LeaveOrgSection({
  orgName,
  isOwner,
  isOnlyMember,
  isLeaving,
  onLeave,
}: LeaveOrgSectionProps) {
  const { t } = useTranslation();
  if (isOnlyMember) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-destructive">
              {t("orgSettings.leaveOrg.willDeleteOrg")}
            </p>
            <p className="text-muted-foreground mt-0.5">
              {t("orgSettings.leaveOrg.onlyMemberDesc")}{" "}
              <strong>{orgName}</strong>.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isLeaving}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              {isLeaving
                ? t("common.saving")
                : t("orgSettings.leaveOrg.deleteAndLeave")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("orgSettings.leaveOrg.deleteOrg")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("orgSettings.leaveOrg.deleteOrgDesc")}{" "}
                <strong>{orgName}</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onLeave}
              >
                {t("orgSettings.leaveOrg.deleteAndLeave")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (isOwner) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <Shield className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              {t("orgSettings.leaveOrg.transferFirst")}
            </p>
            <p className="text-muted-foreground mt-0.5">
              {t("orgSettings.leaveOrg.transferFirstDesc")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled className="gap-2">
          <LogOut className="w-4 h-4" />
          {t("orgSettings.leaveOrg.leaveOrg")}
        </Button>
      </div>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLeaving}
          className="gap-2"
        >
          <LogOut className="w-4 h-4" />
          {isLeaving ? t("common.saving") : t("orgSettings.leaveOrg.leaveOrg")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("orgSettings.leaveOrg.leaveOrg")} {orgName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("orgSettings.leaveOrg.leaveOrgDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onLeave}
          >
            {t("orgSettings.leaveOrg.leaveOrg")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── RoleCard ─────────────────────────────────────────────────────────────────

interface RoleCardProps {
  role: Role;
  canEdit: boolean; // owner only
  members: OrgMemberInfo[]; // full org member list, used to warn before deletion
  onUpdated: () => void;
  onDeleted: () => void;
  onDuplicate: (role: Role) => void;
}

function memberDisplayName(m: OrgMemberInfo): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return name || m.email || m.userId;
}

function RoleCard({
  role,
  canEdit,
  members,
  onUpdated,
  onDeleted,
  onDuplicate,
}: RoleCardProps) {
  const { t } = useTranslation();
  const { t: term, tSingular } = useTerminology();
  const { toast } = useToast();
  const { isFeatureEnabled } = useOrgContext();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(role.name);

  const { mutate: updateRole, isPending: isUpdating } = useUpdateRole({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.roles.roleUpdated") });
        setIsEditingName(false);
        onUpdated();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: deleteRole, isPending: isDeleting } = useDeleteRole({
    mutation: {
      onSuccess: () => {
        toast({
          title: t("orgSettings.roles.roleDeleted"),
          description: t("orgSettings.roles.roleDeletedDesc"),
        });
        onDeleted();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function handlePermToggle(key: PermKey, value: boolean) {
    updateRole({
      id: role.id,
      data: { permissions: { ...role.permissions, [key]: value } },
    });
  }

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === role.name) {
      setIsEditingName(false);
      return;
    }
    updateRole({ id: role.id, data: { name: trimmed } });
  }

  // All built-in roles (Owner, Admin, Member) are read-only at both the API
  // and UI layers. Only custom roles may have their permissions edited.
  const isImmutable = role.isBuiltIn;

  // Members currently assigned to this role — shown in the delete dialog so
  // the owner knows exactly who will be downgraded to the Member built-in role.
  const affectedMembers = members.filter((m) => m.roleId === role.id);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Built-in role notice */}
      {role.isBuiltIn && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t("orgSettings.roles.builtInNotice")}</span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {canEdit && isEditingName ? (
            <form
              onSubmit={handleRenameSubmit}
              className="flex items-center gap-2"
            >
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNameValue(role.name);
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                maxLength={100}
                className="h-7 text-sm font-semibold"
                disabled={isUpdating}
              />
              <Button
                type="submit"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isUpdating || !nameValue.trim()}
              >
                {t("common.save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setNameValue(role.name);
                  setIsEditingName(false);
                }}
              >
                {t("common.cancel")}
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{role.name}</span>
              {role.isBuiltIn && (
                <Badge variant="outline" className="text-xs py-0">
                  {t("orgSettings.roles.builtIn")}
                </Badge>
              )}
              {role.isOwner && (
                <Badge className="text-xs py-0 gap-1">
                  <Crown className="w-3 h-3" />
                  {t("orgSettings.roles.owner")}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-xs py-0 ${affectedMembers.length === 0 ? "text-muted-foreground/50 border-border/50" : "text-muted-foreground"}`}
              >
                {affectedMembers.length}{" "}
                {affectedMembers.length === 1
                  ? t("common.member")
                  : t("common.members")}
              </Badge>
              {canEdit && !role.isBuiltIn && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setNameValue(role.name);
                    setIsEditingName(true);
                  }}
                  title={t("orgSettings.roles.renameRole")}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
        {/* Duplicate */}
        {canEdit && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            onClick={() => onDuplicate(role)}
            title={t("orgSettings.roles.duplicateRole", { name: role.name })}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Delete */}
        {canEdit && !role.isBuiltIn && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title={t("orgSettings.roles.deleteRole")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("orgSettings.roles.deleteRole")} "{role.name}"?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    {affectedMembers.length === 0 ? (
                      <p>{t("orgSettings.roles.noMembersAssigned")}</p>
                    ) : (
                      <>
                        <p>
                          <strong>
                            {affectedMembers.length}{" "}
                            {affectedMembers.length === 1
                              ? t("common.member")
                              : t("common.members")}
                          </strong>{" "}
                          {t("orgSettings.roles.membersReassigned")}
                        </p>
                        <ul className="text-xs rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1 max-h-36 overflow-y-auto">
                          {affectedMembers.slice(0, 8).map((m) => (
                            <li
                              key={m.userId}
                              className="truncate text-foreground"
                            >
                              {memberDisplayName(m)}
                            </li>
                          ))}
                          {affectedMembers.length > 8 && (
                            <li className="text-muted-foreground">
                              …
                              {t("orgSettings.roles.andMore", {
                                count: affectedMembers.length - 8,
                              })}
                            </li>
                          )}
                        </ul>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteRole({ id: role.id })}
                >
                  {t("orgSettings.roles.deleteRole")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Permission groups */}
      <div className="space-y-3">
        {PERM_GROUPS.filter((g) => !g.featureGate || isFeatureEnabled(g.featureGate as any)).map((group) => (
          <div key={group.labelKey}>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              {t(group.labelKey as any, { task: tSingular("tasks"), tasks: term("tasks") })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {group.keys
                .filter((key) => {
                  const gate = group.keyGates?.[key];
                  return !gate || isFeatureEnabled(gate as any);
                })
                .map((key) => {
                  const enabled = role.permissions[key];
                  const editable = canEdit && !isImmutable;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <Switch
                        id={`${role.id}-${key}`}
                        checked={enabled}
                        onCheckedChange={(v) => handlePermToggle(key, v)}
                        disabled={!editable || isUpdating}
                        className="h-4 w-7 data-[state=checked]:bg-primary"
                      />
                      <Label
                        htmlFor={`${role.id}-${key}`}
                        className="text-xs text-muted-foreground cursor-pointer"
                      >
                        {getPermLabels(t, tSingular("tasks"), term("tasks"))[key]}
                      </Label>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TaskTemplatesCard ────────────────────────────────────────────────────────

function getTemplatePriorityOptions(t: (k: string) => string) {
  return [
    { value: "low", label: t("tasks.priorityLow") },
    { value: "medium", label: t("tasks.priorityMedium") },
    { value: "high", label: t("tasks.priorityHigh") },
    { value: "critical", label: t("tasks.priorityCritical") },
  ];
}

function getTemplateCategoryOptions(t: (k: string) => string) {
  return [
    { value: "incident", label: t("tasks.categoryIncident") },
    { value: "change", label: t("tasks.categoryChange") },
    { value: "maintenance", label: t("tasks.categoryMaintenance") },
    { value: "deployment", label: t("tasks.categoryDeployment") },
    { value: "support", label: t("tasks.categorySupport") },
    { value: "other", label: t("tasks.categoryOther") },
  ];
}

interface TemplateFormState {
  name: string;
  defaultTitle: string;
  defaultPriority: string;
  defaultCategory: string;
  defaultDescription: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  defaultTitle: "",
  defaultPriority: "medium",
  defaultCategory: "other",
  defaultDescription: "",
};

function TemplateRow({
  template,
  canEdit,
  onUpdated,
  onDeleted,
}: {
  template: TaskTemplate;
  canEdit: boolean;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<TemplateFormState>({
    name: template.name,
    defaultTitle: template.defaultTitle,
    defaultPriority: template.defaultPriority,
    defaultCategory: template.defaultCategory,
    defaultDescription: template.defaultDescription ?? "",
  });

  const { mutate: updateTemplate, isPending: isUpdating } =
    useUpdateTaskTemplate({
      mutation: {
        onSuccess: () => {
          toast({ title: t("orgSettings.templates.templateUpdated") });
          setIsEditing(false);
          onUpdated();
        },
        onError: (err: Error) => {
          toast({
            title: t("common.error"),
            description: err.message,
            variant: "destructive",
          });
        },
      },
    });

  const { mutate: deleteTemplate, isPending: isDeleting } =
    useDeleteTaskTemplate({
      mutation: {
        onSuccess: () => {
          toast({ title: t("orgSettings.templates.templateDeleted") });
          onDeleted();
        },
        onError: (err: Error) => {
          toast({
            title: t("common.error"),
            description: err.message,
            variant: "destructive",
          });
        },
      },
    });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    updateTemplate({
      id: template.id,
      data: {
        name: form.name.trim(),
        defaultTitle: form.defaultTitle.trim(),
        defaultPriority: form.defaultPriority as
          | "low"
          | "medium"
          | "high"
          | "critical",
        defaultCategory: form.defaultCategory as
          | "incident"
          | "change"
          | "maintenance"
          | "deployment"
          | "support"
          | "other",
        defaultDescription: form.defaultDescription.trim() || null,
      },
    });
  }

  if (isEditing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5"
      >
        <div className="space-y-1">
          <Label className="text-xs">
            {t("orgSettings.templates.templateName")}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t("orgSettings.templates.templateNamePlaceholder")}
            maxLength={200}
            autoFocus
            className="h-8 text-sm"
            disabled={isUpdating}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            {t("orgSettings.templates.defaultTitle")}
          </Label>
          <Input
            value={form.defaultTitle}
            onChange={(e) =>
              setForm((f) => ({ ...f, defaultTitle: e.target.value }))
            }
            placeholder={t("orgSettings.templates.defaultTitlePlaceholder")}
            maxLength={500}
            className="h-8 text-sm"
            disabled={isUpdating}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {t("orgSettings.templates.defaultPriority")}
            </Label>
            <Select
              value={form.defaultPriority}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, defaultPriority: v }))
              }
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getTemplatePriorityOptions(t).map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t("orgSettings.templates.defaultCategory")}
            </Label>
            <Select
              value={form.defaultCategory}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, defaultCategory: v }))
              }
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getTemplateCategoryOptions(t).map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            {t("orgSettings.templates.defaultDescription")}
          </Label>
          <MarkdownEditor
            value={form.defaultDescription}
            onChange={(md) =>
              setForm((f) => ({ ...f, defaultDescription: md }))
            }
            placeholder={t("orgSettings.templates.runbookPlaceholder")}
            readOnly={isUpdating}
            className="h-48 border border-input rounded-md overflow-hidden"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={isUpdating || !form.name.trim()}
          >
            {isUpdating ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isUpdating}
            onClick={() => setIsEditing(false)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{template.name}</p>
        {template.defaultTitle && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Title: {template.defaultTitle}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] py-0 capitalize">
            {template.defaultPriority}
          </Badge>
          <Badge variant="outline" className="text-[10px] py-0 capitalize">
            {template.defaultCategory}
          </Badge>
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsEditing(true)}
            title={t("orgSettings.templates.editTemplate")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title={t("orgSettings.templates.deleteTemplateButton")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("orgSettings.templates.deleteTemplate")} "{template.name}"?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("orgSettings.templates.deleteTemplateDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteTemplate({ id: template.id })}
                >
                  {t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

// ─── Workflow Stages Card ─────────────────────────────────────────────────────

function WorkflowStagesCard() {
  const { t: term, tSingular } = useTerminology();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stages = [], isLoading } = useListWorkflowStages();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6b7280");
  const [editType, setEditType] = useState<"open" | "closed">("open");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [newType, setNewType] = useState<"open" | "closed">("open");
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStage | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>("");

  const { mutate: createStage, isPending: isCreatingStage } =
    useCreateWorkflowStage({
      mutation: {
        onSuccess: () => {
          toast({ title: t("orgSettings.workflow.stageCreated") });
          setIsCreating(false);
          setNewName("");
          setNewColor("#6b7280");
          setNewType("open");
          queryClient.invalidateQueries({
            queryKey: getListWorkflowStagesQueryKey(),
          });
        },
        onError: (e: unknown) =>
          toast({
            title: t("common.error"),
            description: String((e as { message?: string })?.message ?? e),
            variant: "destructive",
          }),
      },
    });

  const { mutate: updateStage, isPending: isUpdatingStage } =
    useUpdateWorkflowStage({
      mutation: {
        onSuccess: () => {
          toast({ title: t("orgSettings.workflow.stageUpdated") });
          setEditingId(null);
          queryClient.invalidateQueries({
            queryKey: getListWorkflowStagesQueryKey(),
          });
        },
        onError: (e: unknown) =>
          toast({
            title: t("common.error"),
            description: String((e as { message?: string })?.message ?? e),
            variant: "destructive",
          }),
      },
    });

  const { mutate: performDelete, isPending: isDeletingStage } = useMutation({
    mutationFn: async ({
      id,
      reassignTo,
    }: {
      id: number;
      reassignTo?: number;
    }) => {
      const url = reassignTo
        ? `/api/workflow-stages/${id}?reassignTo=${reassignTo}`
        : `/api/workflow-stages/${id}`;
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
    },
    onSuccess: () => {
      toast({ title: t("orgSettings.workflow.stageDeleted") });
      setDeleteTarget(null);
      setReassignTarget("");
      queryClient.invalidateQueries({
        queryKey: getListWorkflowStagesQueryKey(),
      });
    },
    onError: (e: unknown) =>
      toast({
        title: t("common.error"),
        description: String((e as { message?: string })?.message ?? e),
        variant: "destructive",
      }),
  });

  const { mutate: reorderStages } = useReorderWorkflowStages({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getListWorkflowStagesQueryKey(),
        }),
      onError: (e: unknown) =>
        toast({
          title: t("common.error"),
          description: String((e as { message?: string })?.message ?? e),
          variant: "destructive",
        }),
    },
  });

  function startEdit(s: WorkflowStage) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
    setEditType(s.type as "open" | "closed");
  }

  function moveStage(index: number, direction: "up" | "down") {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sorted.length) return;
    const ids = sorted.map((s) => s.id);
    ids.splice(newIndex, 0, ids.splice(index, 1)[0]);
    reorderStages({ data: { ids } });
  }

  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const activeStages = sorted.filter((s) => !s.archivedAt);
  const archivedStages = sorted.filter((s) => s.archivedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Workflow className="w-4 h-4" />
          {tSingular("workflows")} {term("stages")}
        </CardTitle>
        <CardDescription>
          Define the stages tasks move through in your organization. Each stage
          has a name, color, and type (open or closed). Closed stages count as
          resolved for SLA and dashboard metrics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}

        {sorted.map((stage, index) => {
          const isEditing = editingId === stage.id;
          const isActive = !stage.archivedAt;
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${isActive ? "border-border bg-background" : "border-dashed border-border/50 bg-muted/30"}`}
            >
              {/* Color dot */}
              <div
                className="w-4 h-4 rounded-full shrink-0 border border-border/50"
                style={{ backgroundColor: isEditing ? editColor : stage.color }}
              />

              {isEditing ? (
                /* ── Edit mode ── */
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 w-36 text-sm"
                    placeholder={t("orgSettings.workflow.stageName")}
                    maxLength={50}
                  />
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">
                      {t("orgSettings.workflow.color")}
                    </label>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border border-border"
                    />
                  </div>
                  <Select
                    value={editType}
                    onValueChange={(v) => setEditType(v as "open" | "closed")}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">
                        {t("orgSettings.workflow.open")}
                      </SelectItem>
                      <SelectItem value="closed">
                        {t("orgSettings.workflow.closed")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isUpdatingStage || !editName.trim()}
                    onClick={() =>
                      updateStage({
                        id: stage.id,
                        data: {
                          name: editName.trim(),
                          color: editColor,
                          type: editType,
                        },
                      })
                    }
                  >
                    {t("common.save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setEditingId(null)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : (
                /* ── View mode ── */
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <span
                    className={`text-sm font-medium truncate ${!isActive ? "text-muted-foreground line-through" : ""}`}
                  >
                    {stage.name}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${stage.type === "closed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}
                  >
                    {stage.type === "open"
                      ? t("orgSettings.workflow.open")
                      : t("orgSettings.workflow.closed")}
                  </span>
                  {!isActive && (
                    <span className="text-xs text-muted-foreground">
                      {t("orgSettings.workflow.archived")}
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={t("orgSettings.workflow.moveUp")}
                    disabled={index === 0}
                    onClick={() => moveStage(index, "up")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-3.5 h-3.5"
                    >
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={t("orgSettings.workflow.moveDown")}
                    disabled={index === sorted.length - 1}
                    onClick={() => moveStage(index, "down")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-3.5 h-3.5"
                    >
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={t("orgSettings.workflow.editStage")}
                    onClick={() => startEdit(stage)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={
                      isActive
                        ? t("orgSettings.workflow.archive")
                        : t("orgSettings.workflow.unarchive")
                    }
                    onClick={() =>
                      updateStage({
                        id: stage.id,
                        data: { archived: isActive },
                      })
                    }
                  >
                    {isActive ? (
                      <X className="w-3.5 h-3.5" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title={t("orgSettings.workflow.deleteStage")}
                    onClick={() => {
                      setDeleteTarget(stage);
                      setReassignTarget("");
                    }}
                    disabled={!isActive}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* Create new stage */}
        {isCreating ? (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("orgSettings.workflow.stageName")}
              className="h-7 w-36 text-sm"
              maxLength={50}
              autoFocus
            />
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">
                {t("orgSettings.workflow.color")}
              </label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-border"
              />
            </div>
            <Select
              value={newType}
              onValueChange={(v) => setNewType(v as "open" | "closed")}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  {t("orgSettings.workflow.open")}
                </SelectItem>
                <SelectItem value="closed">
                  {t("orgSettings.workflow.closed")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={isCreatingStage || !newName.trim()}
              onClick={() =>
                createStage({
                  data: {
                    name: newName.trim(),
                    color: newColor,
                    type: newType,
                  },
                })
              }
            >
              {t("common.add")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setIsCreating(false);
                setNewName("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs mt-1"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="w-3.5 h-3.5" />{" "}
            {t("orgSettings.workflow.addStage")}
          </Button>
        )}

        {/* Delete confirmation dialog */}
        {deleteTarget && (
          <AlertDialog
            open={!!deleteTarget}
            onOpenChange={(o) => {
              if (!o) {
                setDeleteTarget(null);
                setReassignTarget("");
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("orgSettings.workflow.deleteStage")} "{deleteTarget.name}"?
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span>{t("orgSettings.workflow.deleteStageDesc")}</span>
                  {activeStages.filter((s) => s.id !== deleteTarget.id).length >
                    0 && (
                    <span className="block mt-2">
                      {t("orgSettings.workflow.reassignDesc")}
                      <Select
                        value={reassignTarget}
                        onValueChange={setReassignTarget}
                      >
                        <SelectTrigger className="h-8 mt-2">
                          <SelectValue
                            placeholder={t("orgSettings.workflow.reassignTo")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">
                            {t("orgSettings.workflow.noReassign")}
                          </SelectItem>
                          {activeStages
                            .filter((s) => s.id !== deleteTarget.id)
                            .map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isDeletingStage}
                  onClick={() =>
                    performDelete({
                      id: deleteTarget.id,
                      reassignTo: reassignTarget
                        ? Number(reassignTarget)
                        : undefined,
                    })
                  }
                >
                  {isDeletingStage ? t("common.saving") : t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

function TaskTemplatesCard() {
  const { tSingular } = useTerminology();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: templates = [], isLoading, refetch } = useListTaskTemplates();
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);

  const { mutate: createTemplate, isPending: isCreatingReq } =
    useCreateTaskTemplate({
      mutation: {
        onSuccess: () => {
          toast({ title: t("orgSettings.templates.templateCreated") });
          setIsCreating(false);
          setForm(EMPTY_TEMPLATE_FORM);
          refetch();
        },
        onError: (err: Error) => {
          toast({
            title: t("common.error"),
            description: err.message,
            variant: "destructive",
          });
        },
      },
    });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createTemplate({
      data: {
        name: form.name.trim(),
        defaultTitle: form.defaultTitle.trim() || undefined,
        defaultPriority: form.defaultPriority as
          | "low"
          | "medium"
          | "high"
          | "critical",
        defaultCategory: form.defaultCategory as
          | "incident"
          | "change"
          | "maintenance"
          | "deployment"
          | "support"
          | "other",
        defaultDescription: form.defaultDescription.trim() || undefined,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {t("orgSettings.templates.title", { task: tSingular("tasks") })}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("orgSettings.templates.desc")}
            </CardDescription>
          </div>
          {!isCreating && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              {t("orgSettings.templates.newTemplate")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isCreating && (
          <form
            onSubmit={handleCreate}
            className="space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5 mb-4"
          >
            <p className="text-sm font-medium">
              {t("orgSettings.templates.newTemplate")}
            </p>
            <div className="space-y-1">
              <Label className="text-xs">
                {t("orgSettings.templates.templateName")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t("orgSettings.templates.templateNamePlaceholder")}
                maxLength={200}
                autoFocus
                className="h-8 text-sm"
                disabled={isCreatingReq}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {t("orgSettings.templates.defaultTitle")}
              </Label>
              <Input
                value={form.defaultTitle}
                onChange={(e) =>
                  setForm((f) => ({ ...f, defaultTitle: e.target.value }))
                }
                placeholder={t("orgSettings.templates.defaultTitlePlaceholder")}
                maxLength={500}
                className="h-8 text-sm"
                disabled={isCreatingReq}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  {t("orgSettings.templates.defaultPriority")}
                </Label>
                <Select
                  value={form.defaultPriority}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, defaultPriority: v }))
                  }
                  disabled={isCreatingReq}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getTemplatePriorityOptions(t).map((o) => (
                      <SelectItem
                        key={o.value}
                        value={o.value}
                        className="text-sm"
                      >
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  {t("orgSettings.templates.defaultCategory")}
                </Label>
                <Select
                  value={form.defaultCategory}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, defaultCategory: v }))
                  }
                  disabled={isCreatingReq}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getTemplateCategoryOptions(t).map((o) => (
                      <SelectItem
                        key={o.value}
                        value={o.value}
                        className="text-sm"
                      >
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {t("orgSettings.templates.defaultDescription")}
              </Label>
              <MarkdownEditor
                value={form.defaultDescription}
                onChange={(md) =>
                  setForm((f) => ({ ...f, defaultDescription: md }))
                }
                placeholder={t("orgSettings.templates.runbookPlaceholder")}
                readOnly={isCreatingReq}
                className="h-48 border border-input rounded-md overflow-hidden"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={isCreatingReq || !form.name.trim()}
              >
                {isCreatingReq
                  ? t("common.saving")
                  : t("orgSettings.templates.createTemplate")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isCreatingReq}
                onClick={() => {
                  setIsCreating(false);
                  setForm(EMPTY_TEMPLATE_FORM);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : templates.length === 0 && !isCreating ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("orgSettings.templates.noTemplates")}
          </p>
        ) : (
          <div>
            {templates.map((tmpl) => (
              <TemplateRow
                key={tmpl.id}
                template={tmpl}
                canEdit={true}
                onUpdated={refetch}
                onDeleted={refetch}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── SlaPoliciesCard ──────────────────────────────────────────────────────────

const PRIORITY_LEVEL_VALUES = ["critical", "high", "medium", "low"] as const;
type PriorityLevel = (typeof PRIORITY_LEVEL_VALUES)[number];

function getPriorityLevels(t: (k: string) => string) {
  return [
    {
      value: "critical" as PriorityLevel,
      label: t("tasks.priorityCritical"),
      description: t("orgSettings.sla.criticalDesc"),
    },
    {
      value: "high" as PriorityLevel,
      label: t("tasks.priorityHigh"),
      description: t("orgSettings.sla.highDesc"),
    },
    {
      value: "medium" as PriorityLevel,
      label: t("tasks.priorityMedium"),
      description: t("orgSettings.sla.mediumDesc"),
    },
    {
      value: "low" as PriorityLevel,
      label: t("tasks.priorityLow"),
      description: t("orgSettings.sla.lowDesc"),
    },
  ];
}

interface PolicyDraft {
  responseMinutes: string; // empty string means "no target"
  resolutionMinutes: string;
  warningThresholdPercent: string; // 1–99, empty means use server default (80)
}

function minutesToDisplay(minutes: number | null | undefined): string {
  if (minutes == null) return "";
  return String(minutes);
}

function displayToMinutes(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function SlaPoliciesCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const priorityLevels = getPriorityLevels(t);
  const { data: policies, isLoading, refetch } = useGetSLAPolicies();

  // Build draft state, initialized from server data once loaded
  const [draft, setDraft] = useState<Record<PriorityLevel, PolicyDraft> | null>(
    null,
  );
  const [editing, setEditing] = useState(false);

  // Sync draft when policies load
  const buildDraft = (
    serverPolicies: SlaPolicy[],
  ): Record<PriorityLevel, PolicyDraft> => {
    const map = new Map(
      serverPolicies.map((p) => [p.priority as PriorityLevel, p]),
    );
    return Object.fromEntries(
      priorityLevels.map(({ value }) => {
        const p = map.get(value);
        return [
          value,
          {
            responseMinutes: minutesToDisplay(p?.responseMinutes),
            resolutionMinutes: minutesToDisplay(p?.resolutionMinutes),
            warningThresholdPercent:
              p?.warningThresholdPercent != null
                ? String(p.warningThresholdPercent)
                : "",
          },
        ];
      }),
    ) as Record<PriorityLevel, PolicyDraft>;
  };

  const { mutate: upsertPolicies, isPending: isSaving } = useUpsertSLAPolicies({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.sla.saved") });
        refetch();
        setEditing(false);
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function startEditing() {
    setDraft(buildDraft(policies ?? []));
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(null);
    setEditing(false);
  }

  function handleSave() {
    if (!draft) return;
    const entries = priorityLevels
      .map(({ value }) => {
        const w = parseInt(draft[value].warningThresholdPercent, 10);
        return {
          priority: value as "low" | "medium" | "high" | "critical",
          responseMinutes: displayToMinutes(draft[value].responseMinutes),
          resolutionMinutes: displayToMinutes(draft[value].resolutionMinutes),
          ...(w >= 1 && w <= 99 ? { warningThresholdPercent: w } : {}),
        };
      })
      .filter((e) => e.responseMinutes != null || e.resolutionMinutes != null);

    upsertPolicies({ data: { policies: entries } });
  }

  function updateDraft(
    priority: PriorityLevel,
    field: keyof PolicyDraft,
    value: string,
  ) {
    setDraft((prev) =>
      prev
        ? { ...prev, [priority]: { ...prev[priority], [field]: value } }
        : prev,
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4" />
              {t("orgSettings.sla.title")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("orgSettings.sla.desc")}
            </CardDescription>
          </div>
          {!editing && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={startEditing}
            >
              <Pencil className="w-3.5 h-3.5" />
              {t("common.edit")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {priorityLevels.map(({ value }) => (
              <div
                key={value}
                className="h-12 rounded-md bg-muted animate-pulse"
              />
            ))}
          </div>
        ) : editing && draft ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>{t("common.priority")}</span>
              <span>{t("projects.responseMin", "Response (min)")}</span>
              <span>{t("projects.resolutionMin", "Resolution (min)")}</span>
              <span>{t("projects.warningAt", "Warning at (%)")}</span>
            </div>
            {priorityLevels.map(({ value, label }) => (
              <div
                key={value}
                className="grid grid-cols-[120px_1fr_1fr_1fr] gap-3 items-center"
              >
                <span className="text-sm font-medium">{label}</span>
                <Input
                  type="number"
                  min={1}
                  placeholder={t("orgSettings.sla.noTargetPlaceholder")}
                  value={draft[value].responseMinutes}
                  onChange={(e) =>
                    updateDraft(value, "responseMinutes", e.target.value)
                  }
                  className="h-8 text-sm"
                />
                <Input
                  type="number"
                  min={1}
                  placeholder={t("orgSettings.sla.noTargetPlaceholder")}
                  value={draft[value].resolutionMinutes}
                  onChange={(e) =>
                    updateDraft(value, "resolutionMinutes", e.target.value)
                  }
                  className="h-8 text-sm"
                />
                <Input
                  type="number"
                  min={1}
                  max={99}
                  placeholder="80"
                  value={draft[value].warningThresholdPercent}
                  onChange={(e) =>
                    updateDraft(
                      value,
                      "warningThresholdPercent",
                      e.target.value,
                    )
                  }
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving
                  ? t("common.saving")
                  : t("orgSettings.sla.savePolicies")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {priorityLevels.map(({ value, label, description }) => {
              const p = policies?.find((pol) => pol.priority === value);
              const hasPolicy =
                p && (p.responseMinutes != null || p.resolutionMinutes != null);
              return (
                <div
                  key={value}
                  className="flex items-center gap-3 py-2 border-b border-border last:border-0"
                >
                  <div className="w-24 shrink-0">
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-[10px] text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  {hasPolicy ? (
                    <div className="flex gap-4 text-sm flex-1">
                      {p.responseMinutes != null && (
                        <span className="text-muted-foreground">
                          Response:{" "}
                          <strong className="text-foreground">
                            {p.responseMinutes}m
                          </strong>
                        </span>
                      )}
                      {p.resolutionMinutes != null && (
                        <span className="text-muted-foreground">
                          Resolution:{" "}
                          <strong className="text-foreground">
                            {p.resolutionMinutes}m
                          </strong>
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        Warning at:{" "}
                        <strong className="text-foreground">
                          {p.warningThresholdPercent ?? 80}%
                        </strong>
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground flex-1">
                      {t("orgSettings.sla.noTarget")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── OrgSettings page ─────────────────────────────────────────────────────────

export default function OrgSettings() {
  const { t: term, tSingular } = useTerminology();
  const { t } = useTranslation();
  const { org, isAdmin, isOwner, hasPermission, refetchOrg, isFeatureEnabled } =
    useOrgContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  // Check instance-admin status once on mount — used to show the admin console link.
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);
  useEffect(() => {
    fetch(`${BASE}/api/admin/me`, { credentials: "include" })
      .then((r) => {
        if (r.ok) setIsInstanceAdmin(true);
      })
      .catch(() => {});
  }, []);

  // ── Tab navigation ───────────────────────────────────────────────────────────
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const showBrandingTab =
    isFeatureEnabled("branding") && hasPermission("manage_org_settings");
  const showStagesTab = isFeatureEnabled("custom_statuses") && isAdmin;
  const showTemplatesTab = isAdmin;
  const showSlaTab = isFeatureEnabled("sla_tracking") && isAdmin;
  const showCustomFieldsTab = isFeatureEnabled("custom_fields") && isAdmin;
  const showApiKeysTab = isFeatureEnabled("api_keys") && isOwner;
  const showExportTab = isFeatureEnabled("data_export") && isAdmin;

  const tabVisible: Record<string, boolean> = {
    general: true,
    members: true,
    roles: true,
    branding: showBrandingTab,
    stages: showStagesTab,
    templates: showTemplatesTab,
    sla: showSlaTab,
    customFields: showCustomFieldsTab,
    apiKeys: showApiKeysTab,
    export: showExportTab,
  };

  const requestedTab =
    new URLSearchParams(searchString).get("tab") ?? "general";
  const activeTab = tabVisible[requestedTab] ? requestedTab : "general";

  function handleTabChange(tab: string) {
    setLocation(`/org/settings?tab=${tab}`);
  }

  const [inviteValue, setInviteValue] = useState("");
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePermissions, setNewRolePermissions] =
    useState<RolePermissions | null>(null);
  const [duplicateSourceName, setDuplicateSourceName] = useState("");

  // ── Rename state ────────────────────────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(org?.name ?? "");

  const { mutate: renameOrg, isPending: isRenaming } = useRenameOrg({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.orgRenamed") });
        refetchOrg();
        setIsEditingName(false);
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === org?.name) {
      setIsEditingName(false);
      return;
    }
    renameOrg({ data: { name: trimmed } });
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  const { data: members = [], refetch: refetchMembers } = useListOrgMembers();
  const { data: invitations = [], refetch: refetchInvitations } =
    useListOrgInvitations();
  const { data: roles = [], refetch: refetchRoles } = useListRoles();

  const canManageMembers = hasPermission("manage_members");

  // Pending ownership transfer awaiting confirmation: { userId, roleId, name }
  const [pendingTransfer, setPendingTransfer] = useState<{
    userId: string;
    roleId: string;
    name: string;
  } | null>(null);

  const { mutate: updateMemberRole } = useUpdateOrgMemberRole({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.roles.roleUpdated") });
        refetchMembers();
        refetchOrg();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: removeMember } = useRemoveOrgMember({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.members.memberRemoved") });
        refetchMembers();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: cancelInvitation } = useCancelOrgInvitation({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.members.invitationCanceled") });
        refetchInvitations();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: inviteMember, isPending: isInviting } = useInviteOrgMember({
    mutation: {
      onSuccess: (data) => {
        const link = buildInviteLink(data.token);
        const isEmail = inviteValue.trim().includes("@");
        navigator.clipboard.writeText(link).catch(() => {});
        toast({
          title: isEmail
            ? t("orgSettings.members.invitationSent")
            : t("orgSettings.members.inviteLinkCopied"),
          description: isEmail
            ? t("orgSettings.members.invitationSentDesc")
            : t("orgSettings.members.inviteLinkDesc"),
        });
        setInviteValue("");
        refetchInvitations();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const { mutate: leaveOrg, isPending: isLeaving } = useLeaveOrg({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.members.leftOrg") });
        refetchOrg();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  // ── Roles management ────────────────────────────────────────────────────────
  const { mutate: createRole, isPending: isCreatingRoleReq } = useCreateRole({
    mutation: {
      onSuccess: () => {
        toast({ title: t("orgSettings.roles.roleCreated") });
        setIsCreatingRole(false);
        setNewRoleName("");
        setNewRolePermissions(null);
        setDuplicateSourceName("");
        refetchRoles();
      },
      onError: (err: Error) => {
        toast({
          title: t("common.error"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteValue.trim()) return;
    const val = inviteValue.trim();
    const isEmail = val.includes("@");
    inviteMember({ data: isEmail ? { email: val } : { userId: val } });
  }

  function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newRoleName.trim();
    if (!trimmed) return;
    // newRolePermissions is always set when the form is open (BLANK_PERMISSIONS
    // for a fresh role, cloned permissions for a duplicate).
    createRole({
      data: {
        name: trimmed,
        permissions: newRolePermissions ?? BLANK_PERMISSIONS,
      },
    });
  }

  function handleNewRolePermToggle(key: PermKey, value: boolean) {
    setNewRolePermissions((prev) => ({
      ...(prev ?? BLANK_PERMISSIONS),
      [key]: value,
    }));
  }

  function handleDuplicate(source: Role) {
    setNewRoleName(`Copy of ${source.name}`);
    setNewRolePermissions(source.permissions as RolePermissions);
    setDuplicateSourceName(source.name);
    setIsCreatingRole(true);
  }

  function cancelCreateRole() {
    setIsCreatingRole(false);
    setNewRoleName("");
    setNewRolePermissions(null);
    setDuplicateSourceName("");
  }

  function getDisplayName(m: OrgMemberInfo) {
    if (m.firstName || m.lastName)
      return [m.firstName, m.lastName].filter(Boolean).join(" ");
    return m.email ?? m.userId;
  }

  return (
    <div className="mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Building2 className="w-7 h-7 text-primary" />
          {t("orgSettings.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isOwner
            ? t("orgSettings.descOwner")
            : isAdmin
              ? t("orgSettings.descAdmin")
              : t("orgSettings.descMember")}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Tab bar — scrolls horizontally on small screens */}
        <TabsList className="flex h-auto flex-wrap gap-1 overflow-x-auto [&_button]:gap-1.5">
          <TabsTrigger value="general">
            <Settings2 className="w-4 h-4 text-primary"/> {t("orgSettings.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="members">
            <ShieldUser className="w-4 h-4 text-primary"/> {t("orgSettings.tabs.members")}
          </TabsTrigger>
          <TabsTrigger value="roles">
            <Users className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.roles")}
          </TabsTrigger>
          {showBrandingTab && (
            <TabsTrigger value="branding">
              <Paintbrush className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.branding")}
            </TabsTrigger>
          )}
          {showStagesTab && (
            <TabsTrigger value="stages">
              <Workflow className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.stages")}
            </TabsTrigger>
          )}
          {showTemplatesTab && (
            <TabsTrigger value="templates">
              <NotepadTextDashed className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.templates")}
            </TabsTrigger>
          )}
          {showSlaTab && (
            <TabsTrigger value="sla">
              <Siren className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.sla")}
            </TabsTrigger>
          )}
          {showCustomFieldsTab && (
            <TabsTrigger value="customFields">
              <RectangleEllipsis className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.customFields")}
            </TabsTrigger>
          )}
          {showApiKeysTab && (
            <TabsTrigger value="apiKeys">
              <Key className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.apiKeys")}
            </TabsTrigger>
          )}
          {showExportTab && (
            <TabsTrigger value="export">
              <Download className="w-4 h-4 text-primary" /> {t("orgSettings.tabs.export")}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── General ──────────────────────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-6 mt-6">
          {/* Org Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("orgSettings.orgInfo")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {isOwner && isEditingName ? (
                    <form
                      onSubmit={handleRenameSubmit}
                      className="flex items-center gap-2"
                    >
                      <Input
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setNameValue(org?.name ?? "");
                            setIsEditingName(false);
                          }
                        }}
                        autoFocus
                        maxLength={200}
                        className="h-8 text-sm font-semibold"
                        disabled={isRenaming}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={isRenaming || !nameValue.trim()}
                      >
                        {isRenaming ? t("common.saving") : t("common.save")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setNameValue(org?.name ?? "");
                          setIsEditingName(false);
                        }}
                        disabled={isRenaming}
                      >
                        {t("common.cancel")}
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{org?.name}</p>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => {
                            setNameValue(org?.name ?? "");
                            setIsEditingName(true);
                          }}
                          title={t("orgSettings.general.renameTitle")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {org?.id}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Instance Admin Console */}
          {isInstanceAdmin && (
            <Card className="border-primary/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      {t("orgSettings.adminConsole.title")}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t("orgSettings.adminConsole.desc")}
                    </CardDescription>
                  </div>
                  <a href={`${BASE}/admin`} target="_blank" rel="noreferrer">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {t("orgSettings.adminConsole.openConsole")}
                    </Button>
                  </a>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Danger Zone */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                {t("orgSettings.dangerZone")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeaveOrgSection
                orgName={org?.name ?? ""}
                isOwner={isOwner}
                isOnlyMember={members.length <= 1}
                isLeaving={isLeaving}
                onLeave={() => leaveOrg()}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Members ──────────────────────────────────────────────────────── */}
        <TabsContent value="members" className="space-y-6 mt-6">
          {/* Ownership transfer confirmation dialog (overlay — rendered here so it's
              available whenever the Members tab is mounted) */}
          <AlertDialog
            open={pendingTransfer !== null}
            onOpenChange={(open) => {
              if (!open) setPendingTransfer(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("orgSettings.members.transferOwnership")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingTransfer?.name}{" "}
                  {t("orgSettings.members.transferOwnershipDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    if (pendingTransfer) {
                      updateMemberRole({
                        userId: pendingTransfer.userId,
                        data: { roleId: pendingTransfer.roleId },
                      });
                    }
                    setPendingTransfer(null);
                  }}
                >
                  {t("orgSettings.members.transferOwnership")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Members list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{term("members")}</CardTitle>
              <CardDescription>
                {members.length}{" "}
                {members.length !== 1
                  ? term("members").toLowerCase()
                  : tSingular("members").toLowerCase()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {members.map((m) => {
                const isMe = m.userId === user?.id;
                return (
                  <div
                    key={m.userId}
                    className="flex items-center gap-3 py-2 border-b border-border last:border-0"
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center border border-border shrink-0 text-xs font-bold text-primary">
                      {m.firstName?.[0] ?? m.email?.[0] ?? "?"}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {getDisplayName(m)}
                        </span>
                        {isMe && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            {t("orgSettings.members.youBadge")}
                          </Badge>
                        )}
                      </div>
                      {m.email && (
                        <p className="text-xs text-muted-foreground truncate">
                          {m.email}
                        </p>
                      )}
                    </div>
                    {/* Role badge or selector */}
                    {canManageMembers &&
                    !isMe &&
                    (isOwner || m.roleName !== "Owner") ? (
                      <Select
                        value={m.roleId}
                        onValueChange={(roleId) => {
                          const selected = roles.find((r) => r.id === roleId);
                          if (selected?.isOwner) {
                            setPendingTransfer({
                              userId: m.userId,
                              roleId,
                              name: getDisplayName(m),
                            });
                          } else {
                            updateMemberRole({
                              userId: m.userId,
                              data: { roleId },
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles
                            .filter((r) => isOwner || !r.isOwner)
                            .map((r) => (
                              <SelectItem
                                key={r.id}
                                value={r.id}
                                className="text-xs"
                              >
                                {r.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant={roleBadgeVariant(m.roleName)}
                        className="text-xs shrink-0 gap-1"
                      >
                        {m.roleName === "Owner" && (
                          <Crown className="w-3 h-3" />
                        )}
                        {m.roleName}
                      </Badge>
                    )}
                    {/* Remove */}
                    {canManageMembers &&
                      !isMe &&
                      (isOwner || m.roleName !== "Owner") && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title={t("orgSettings.members.removeMember")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("orgSettings.members.removeMember")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {getDisplayName(m)}{" "}
                                {t("orgSettings.members.removeMemberDesc")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("common.cancel")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() =>
                                  removeMember({ userId: m.userId })
                                }
                              >
                                {t("orgSettings.members.removeMember")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Pending invitations */}
          {isAdmin && invitations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t("orgSettings.members.pendingInvitations")}
                </CardTitle>
                <CardDescription>
                  {invitations.length}{" "}
                  {t("orgSettings.members.awaitingResponse")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {invitations.map((inv) => {
                  const recipient =
                    inv.invitedEmail ?? inv.invitedUserId ?? "Unknown";
                  const expiresAt = new Date(inv.expiresAt);
                  const daysLeft = Math.max(
                    0,
                    Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000),
                  );
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-3 py-2 border-b border-border last:border-0"
                    >
                      <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center border border-border shrink-0 text-xs font-bold text-muted-foreground">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {recipient}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("orgSettings.members.expiresIn")} {daysLeft}{" "}
                          {t("common.days")}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {t("orgSettings.members.invitePending")}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                        title={t("orgSettings.members.copyInviteTitle")}
                        onClick={() => {
                          navigator.clipboard
                            .writeText(buildInviteLink(inv.token))
                            .catch(() => {});
                          toast({
                            title: t("orgSettings.members.inviteLinkCopied"),
                          });
                        }}
                      >
                        <Link2 className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            title={t("orgSettings.members.cancelInviteTitle")}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("orgSettings.members.cancelInvitation")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("orgSettings.members.cancelInvitationDesc")}{" "}
                              <strong>{recipient}</strong>.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              {t("orgSettings.members.keepInvitation")}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => cancelInvitation({ id: inv.id })}
                            >
                              {t("orgSettings.members.cancelInvitation")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Invite member */}
          {canManageMembers && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  {t("orgSettings.members.inviteMember", {
                    member: tSingular("members"),
                  })}
                </CardTitle>
                <CardDescription>
                  {t("orgSettings.members.inviteMemberDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleInvite} className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder={t("orgSettings.members.emailPlaceholder")}
                      value={inviteValue}
                      onChange={(e) => setInviteValue(e.target.value)}
                      disabled={isInviting}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isInviting || !inviteValue.trim()}
                    className="gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    {isInviting
                      ? t("common.saving")
                      : t("orgSettings.members.sendInvite")}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Roles ────────────────────────────────────────────────────────── */}
        <TabsContent value="roles" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    {t("orgSettings.roles.title", {
                      member: tSingular("members"),
                    })}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {isOwner
                      ? t("orgSettings.roles.descOwner")
                      : t("orgSettings.roles.descMember")}
                  </CardDescription>
                </div>
                {isOwner && !isCreatingRole && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => {
                      setNewRolePermissions(BLANK_PERMISSIONS);
                      setDuplicateSourceName("");
                      setIsCreatingRole(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("orgSettings.roles.newRole")}
                  </Button>
                )}
              </div>
              {isOwner && isCreatingRole && (
                <form
                  onSubmit={handleCreateRole}
                  className="mt-4 rounded-lg border border-border bg-muted/30 p-4 space-y-4"
                >
                  {duplicateSourceName && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Copy className="w-3 h-3 shrink-0" />
                      {t("orgSettings.roles.copiedPermissionsFrom", {
                        name: duplicateSourceName,
                      })}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder={t("orgSettings.roles.roleNamePlaceholder")}
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      maxLength={100}
                      disabled={isCreatingRoleReq}
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isCreatingRoleReq || !newRoleName.trim()}
                    >
                      {isCreatingRoleReq
                        ? t("common.saving")
                        : t("orgSettings.roles.createRole")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={cancelCreateRole}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {PERM_GROUPS.filter((g) => !g.featureGate || isFeatureEnabled(g.featureGate as any)).map((group) => (
                      <div key={group.labelKey}>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">
                          {t(group.labelKey as any, { task: tSingular("tasks"), tasks: term("tasks") })}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {group.keys
                            .filter((key) => {
                              const gate = group.keyGates?.[key];
                              return !gate || isFeatureEnabled(gate as any);
                            })
                            .map((key) => (
                              <div key={key} className="flex items-center gap-2">
                                <Switch
                                  id={`new-role-${key}`}
                                  checked={newRolePermissions?.[key] ?? false}
                                  onCheckedChange={(v) =>
                                    handleNewRolePermToggle(key, v)
                                  }
                                  disabled={isCreatingRoleReq}
                                  className="h-4 w-7 data-[state=checked]:bg-primary"
                                />
                                <Label
                                  htmlFor={`new-role-${key}`}
                                  className="text-xs text-muted-foreground cursor-pointer"
                                >
                                  {getPermLabels(t, tSingular("tasks"), term("tasks"))[key]}
                                </Label>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </form>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  canEdit={isOwner}
                  members={members}
                  onUpdated={refetchRoles}
                  onDeleted={() => {
                    refetchRoles();
                    refetchMembers();
                  }}
                  onDuplicate={handleDuplicate}
                />
              ))}
              {roles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("orgSettings.roles.noRolesFound")}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Branding (feature-gated) ──────────────────────────────────────── */}
        {showBrandingTab && (
          <TabsContent value="branding" className="space-y-6 mt-6">
            <BrandingCard />
            {/* Terminology */}
            <TerminologyCard />

            {/* Reaction Palette */}
            <ReactionPaletteCard />
          </TabsContent>
        )}

        {/* ── Workflow Stages (feature-gated) ──────────────────────────────── */}
        {showStagesTab && (
          <TabsContent value="stages" className="space-y-6 mt-6">
            <FeatureGate feature="custom_statuses">
              <WorkflowStagesCard />
            </FeatureGate>
          </TabsContent>
        )}

        {/* ── Task Templates (admin only) ───────────────────────────────────── */}
        {showTemplatesTab && (
          <TabsContent value="templates" className="space-y-6 mt-6">
            <TaskTemplatesCard />
          </TabsContent>
        )}

        {/* ── SLA Policies (feature-gated) ──────────────────────────────────── */}
        {showSlaTab && (
          <TabsContent value="sla" className="space-y-6 mt-6">
            <FeatureGate feature="sla_tracking">
              <SlaPoliciesCard />
            </FeatureGate>
          </TabsContent>
        )}

        {/* ── Custom Fields (feature-gated) ─────────────────────────────────── */}
        {showCustomFieldsTab && (
          <TabsContent value="customFields" className="space-y-6 mt-6">
            <FeatureGate feature="custom_fields">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sliders className="w-4 h-4" />
                    {t("customFields.title")}
                  </CardTitle>
                  <CardDescription>{t("customFields.desc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <CustomFieldsManager />
                </CardContent>
              </Card>
            </FeatureGate>
          </TabsContent>
        )}

        {/* ── API Keys (feature-gated, owner only) ──────────────────────────── */}
        {showApiKeysTab && (
          <TabsContent value="apiKeys" className="space-y-6 mt-6">
            <FeatureGate feature="api_keys">
              <ApiKeysCard />
            </FeatureGate>
          </TabsContent>
        )}

        {/* ── Export (feature-gated) ────────────────────────────────────────── */}
        {showExportTab && (
          <TabsContent value="export" className="space-y-6 mt-6">
            <FeatureGate feature="data_export">
              <ExportCard />
            </FeatureGate>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
