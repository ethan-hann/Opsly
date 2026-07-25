import {
  useListTasks,
  useListOrgMembers,
  useListViews,
  useCreateView,
  useUpdateView,
  useDeleteView,
  useGetSLAPolicies,
  useListTaskTemplates,
  useBulkUpdateTasks,
  useBulkDeleteTasks,
  useListWorkflowStages,
  useListCustomFieldDefinitions,
} from "@workspace/api-client-react";
import { useTranslation } from 'react-i18next';
import { useTerminology } from "@/context/terminology-context";
import type { TaskTemplate, BulkCloseBlockedTask } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { FeatureGate } from "@/components/ui/feature-gate";
import { formatDate } from "@/lib/utils";
import {
  Plus,
  Search,
  LayoutList,
  Columns,
  ChevronDown,
  X,
  Bookmark,
  Globe,
  Lock,
  Pencil,
  Trash2,
  Star,
  FileText,
  CheckSquare,
  UserCheck,
  Tag,
  AlertCircle,
  Layers,
  Eye,
  ShieldAlert,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useCallback, useEffect, useRef } from "react";
import { KanbanBoard } from "@/components/ui/kanban-board";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useAuth } from "@workspace/replit-auth-web";
import type { SavedView } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgContext } from "@/hooks/use-org-context";
import { useToast } from "@/hooks/use-toast";
import {
  getListTasksQueryKey,
  getListViewsQueryKey,
} from "@workspace/api-client-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectFilter = "all" | "with_project" | "no_project";

interface ActiveFilters {
  status: string;
  priority: string;
  category: string;
  assignee: string;
  dateFrom: string;
  dateTo: string;
  projectFilter: ProjectFilter;
  search: string;
  watching: boolean;
  slaBreached: boolean;
  stageType: string; // "open" | "closed" | ""
  overdue: boolean;
  customFieldId: string; // numeric ID as string, or ""
  customFieldValue: string; // option value, or ""
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Status options are now dynamic - fetched from the org's workflow stages

// Priority and category option labels are built inside the component using t()
// to support i18n. The value is the raw API value.

function getProjectFilterOptions(
  tLabel: (key: string) => string,
  tSingular: (key: string) => string,
  tI18n: (key: string, opts?: Record<string, unknown>) => string,
): { value: ProjectFilter; label: string }[] {
  return [
    { value: "all", label: tI18n('tasks.allTasks', { tasks: tLabel("tasks") }) },
    { value: "with_project", label: tI18n('tasks.withProject', { project: tSingular("projects") }) },
    { value: "no_project", label: tI18n('tasks.noProject', { project: tSingular("projects") }) },
  ];
}

// ─── URL state hook ───────────────────────────────────────────────────────────

export function useTaskFilters() {
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();

  const params = new URLSearchParams(urlSearch);

  const filters: ActiveFilters = {
    status: params.get("status") ?? "",
    priority: params.get("priority") ?? "",
    category: params.get("category") ?? "",
    assignee: params.get("assignee") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    projectFilter: (params.get("project") as ProjectFilter) ?? "all",
    search: params.get("search") ?? "",
    watching: params.get("watching") === "true",
    slaBreached: params.get("slaBreached") === "true",
    stageType: params.get("stageType") ?? "",
    overdue: params.get("overdue") === "true",
    customFieldId: params.get("customFieldId") ?? "",
    customFieldValue: params.get("customFieldValue") ?? "",
  };

  const activeViewId = params.get("viewId")
    ? Number(params.get("viewId"))
    : null;

  const setFilter = useCallback(
    (key: keyof ActiveFilters, value: string) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set(key === "projectFilter" ? "project" : key, value);
      } else {
        next.delete(key === "projectFilter" ? "project" : key);
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const setSearch = useCallback(
    (value: string) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set("search", value);
      } else {
        next.delete("search");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const clearAll = useCallback(() => {
    setLocation("?", { replace: true });
  }, [setLocation]);

  const applyView = useCallback(
    (view: SavedView) => {
      const next = new URLSearchParams();
      const f = view.filters;
      if (f.status) next.set("status", f.status);
      if (f.priority) next.set("priority", f.priority);
      if (f.category) next.set("category", f.category);
      if (f.assignee) next.set("assignee", f.assignee);
      if (f.dateFrom) next.set("dateFrom", f.dateFrom);
      if (f.dateTo) next.set("dateTo", f.dateTo);
      if (f.projectFilter && f.projectFilter !== "all")
        next.set("project", f.projectFilter);
      if (f.search) next.set("search", f.search);
      if (f.customFieldId) {
        next.set("customFieldId", String(f.customFieldId));
        if (f.customFieldValue)
          next.set("customFieldValue", f.customFieldValue);
      }
      if (f.watching) next.set("watching", "true");
      if (f.slaBreached) next.set("slaBreached", "true");
      if (f.overdue) next.set("overdue", "true");
      if (f.stageType) next.set("stageType", f.stageType);
      next.set("viewId", String(view.id));
      setLocation("?" + next.toString(), { replace: true });
    },
    [setLocation],
  );

  const setWatching = useCallback(
    (value: boolean) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set("watching", "true");
      } else {
        next.delete("watching");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const setSlaBreached = useCallback(
    (value: boolean) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set("slaBreached", "true");
      } else {
        next.delete("slaBreached");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const setStageType = useCallback(
    (value: string) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set("stageType", value);
      } else {
        next.delete("stageType");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const setOverdue = useCallback(
    (value: boolean) => {
      const next = new URLSearchParams(urlSearch);
      if (value) {
        next.set("overdue", "true");
      } else {
        next.delete("overdue");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const setCustomFieldFilter = useCallback(
    (fieldId: string, fieldValue: string) => {
      const next = new URLSearchParams(urlSearch);
      if (fieldId) {
        next.set("customFieldId", fieldId);
        if (fieldValue) {
          next.set("customFieldValue", fieldValue);
        } else {
          next.delete("customFieldValue");
        }
      } else {
        next.delete("customFieldId");
        next.delete("customFieldValue");
      }
      setLocation("?" + next.toString(), { replace: true });
    },
    [urlSearch, setLocation],
  );

  const hasActiveFilters =
    !!filters.status ||
    !!filters.priority ||
    !!filters.category ||
    !!filters.assignee ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    !!filters.search ||
    filters.watching ||
    filters.slaBreached ||
    !!filters.stageType ||
    filters.overdue ||
    !!filters.customFieldId;

  return {
    filters,
    setFilter,
    setSearch,
    setWatching,
    setSlaBreached,
    setStageType,
    setOverdue,
    setCustomFieldFilter,
    clearAll,
    applyView,
    hasActiveFilters,
    activeViewId,
  };
}

// ─── Filter chip component ────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  value: string;
  activeLabel?: string;
  children: React.ReactNode;
  onClear: () => void;
}

function FilterChip({
  label,
  value,
  activeLabel,
  children,
  onClear,
}: FilterChipProps) {
  const isActive = !!value;
  return (
    <Popover>
      <div className="flex items-center">
        <PopoverTrigger asChild>
          <button
            className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-l-md font-medium border transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background/50 text-muted-foreground border-border hover:text-foreground hover:bg-background"
            }`}
          >
            {isActive ? (activeLabel ?? label) : label}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        {isActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="flex items-center justify-center w-6 h-8 rounded-r-md border border-l-0 border-primary bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
            aria-label={`Clear ${label} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {!isActive && <div className="w-0 border-r-0" />}
      </div>
      <PopoverContent className="w-48 p-1" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// Shared option list inside a popover
function OptionList({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(value === opt.value ? "" : opt.value)}
          className={`w-full text-left px-3 py-1.5 text-xs rounded-sm transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Save View Popover ────────────────────────────────────────────────────────

interface SaveViewPopoverProps {
  filters: ActiveFilters;
  activeViewId: number | null;
  views: SavedView[];
  userId: string | undefined;
}

function SaveViewPopover({
  filters,
  activeViewId,
  views,
  userId,
}: SaveViewPopoverProps) {
  const { t } = useTranslation();
  const search = filters.search;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isOrgWide, setIsOrgWide] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const createView = useCreateView();
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const queryClient = useQueryClient();

  // viewId stays in the URL until the user explicitly clears all filters, so
  // activeView remains non-null throughout any in-session filter editing.
  const activeView = activeViewId
    ? views.find((v) => v.id === activeViewId)
    : null;
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSave = async () => {
    if (!name.trim()) return;
    const filterPayload = {
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      category: filters.category || undefined,
      assignee: filters.assignee || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      projectFilter:
        filters.projectFilter !== "all" ? filters.projectFilter : undefined,
      search: search || undefined,
      customFieldId: filters.customFieldId
        ? Number(filters.customFieldId)
        : undefined,
      customFieldValue:
        filters.customFieldId && filters.customFieldValue
          ? filters.customFieldValue
          : undefined,
      watching: filters.watching || undefined,
      slaBreached: filters.slaBreached || undefined,
      overdue: filters.overdue || undefined,
      stageType: filters.stageType || undefined,
    };
    await createView.mutateAsync({
      data: { name: name.trim(), filters: filterPayload, isOrgWide, isDefault },
    });
    await queryClient.invalidateQueries({ queryKey: getListViewsQueryKey() });
    setName("");
    setIsOrgWide(false);
    setIsDefault(false);
    setOpen(false);
  };

  const handleUpdateFilters = async () => {
    if (!activeView) return;
    const filterPayload = {
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      category: filters.category || undefined,
      assignee: filters.assignee || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      projectFilter:
        filters.projectFilter !== "all" ? filters.projectFilter : undefined,
      search: search || undefined,
      customFieldId: filters.customFieldId
        ? Number(filters.customFieldId)
        : undefined,
      customFieldValue:
        filters.customFieldId && filters.customFieldValue
          ? filters.customFieldValue
          : undefined,
      watching: filters.watching || undefined,
      slaBreached: filters.slaBreached || undefined,
      overdue: filters.overdue || undefined,
      stageType: filters.stageType || undefined,
    };
    await updateView.mutateAsync({
      id: activeView.id,
      data: { filters: filterPayload },
    });
    await queryClient.invalidateQueries({ queryKey: getListViewsQueryKey() });
    setOpen(false);
  };

  const handleRename = async (viewId: number) => {
    if (!newName.trim()) return;
    await updateView.mutateAsync({
      id: viewId,
      data: { name: newName.trim() },
    });
    await queryClient.invalidateQueries({ queryKey: getListViewsQueryKey() });
    setEditingName(false);
    setNewName("");
  };

  const handleDelete = async (viewId: number) => {
    await deleteView.mutateAsync({ id: viewId });
    await queryClient.invalidateQueries({ queryKey: getListViewsQueryKey() });
    setOpen(false);
  };

  const handleToggleDefault = async (view: SavedView) => {
    await updateView.mutateAsync({
      id: view.id,
      data: { isDefault: !view.isDefault },
    });
    await queryClient.invalidateQueries({ queryKey: getListViewsQueryKey() });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={activeView ? "secondary" : "outline"}
          size="sm"
          className="h-8 gap-1.5 text-xs"
        >
          <Bookmark
            className={`w-3.5 h-3.5 ${activeView ? "fill-current" : ""}`}
          />
          {activeView ? activeView.name : t('tasks.saveView')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          {/* If viewing an active saved view, show its controls */}
          {activeView && (
            <div className="pb-2 border-b border-border">
              <div className="flex items-center justify-between mb-1">
                {editingName ? (
                  <div className="flex gap-1 flex-1">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="h-7 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(activeView.id);
                        if (e.key === "Escape") {
                          setEditingName(false);
                          setNewName("");
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => handleRename(activeView.id)}
                      disabled={updateView.isPending}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-medium">{activeView.name}</p>
                    <div className="flex gap-1">
                      {activeView.createdBy === userId && (
                        <>
                          <button
                            onClick={() => handleToggleDefault(activeView)}
                            className={`p-1 rounded transition-colors ${activeView.isDefault ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                            title={
                              activeView.isDefault
                                ? "Remove default"
                                : "Set as default"
                            }
                          >
                            <Star
                              className="w-3.5 h-3.5"
                              fill={
                                activeView.isDefault ? "currentColor" : "none"
                              }
                            />
                          </button>
                          <button
                            onClick={() => {
                              setEditingName(true);
                              setNewName(activeView.name);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                            title={t("common.rename")}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(activeView.id)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                            title={t("tasks.deleteView")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {activeView.isOrgWide ? (
                  <>
                    <Globe className="w-3 h-3" /> {t("tasks.orgWide")}
                  </>
                ) : (
                  <>
                    <Lock className="w-3 h-3" /> {t("tasks.personalView")}
                  </>
                )}
                {activeView.isDefault && (
                  <span className="ml-1 text-primary">{t("tasks.defaultIndicator")}</span>
                )}
              </div>
              {activeView.createdBy === userId && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full h-7 text-xs mt-2"
                  onClick={handleUpdateFilters}
                  disabled={updateView.isPending}
                >
                  {updateView.isPending ? t('common.saving') : t('tasks.updateView')}
                </Button>
              )}
            </div>
          )}

          {/* Save current filters as a new view */}
          <div>
            <p className="text-xs font-semibold mb-2">
              {activeView ? t('tasks.saveAsNew') : t('tasks.saveView')}
            </p>
            <Input
              placeholder={t('tasks.viewName') + "..."}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs mb-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus={!activeView}
            />
            <div className="flex items-center gap-3 mb-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isOrgWide}
                  onChange={(e) => setIsOrgWide(e.target.checked)}
                  className="rounded"
                />
                <Globe className="w-3 h-3" />
                {t('tasks.orgWide')}
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded"
                />
                <Star className="w-3 h-3" />
                {t('tasks.defaultView')}
              </label>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleSave}
              disabled={!name.trim() || createView.isPending}
            >
              {createView.isPending ? t('common.saving') : t('tasks.saveView')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

interface BulkActionBarProps {
  selectedIds: Set<number>;
  onClear: () => void;
  assigneeOptions: { value: string; label: string }[];
  canDelete: boolean;
  onBulkUpdate: (patch: {
    status?: string;
    priority?: string;
    category?: string;
    assignee?: string | null;
  }) => Promise<void>;
  onBulkDelete: () => Promise<void>;
  isPending: boolean;
}

function BulkActionBar({
  selectedIds,
  onClear,
  assigneeOptions,
  canDelete,
  onBulkUpdate,
  onBulkDelete,
  isPending,
  stageOptions,
}: BulkActionBarProps & { stageOptions: { value: string; label: string }[] }) {
  const { t } = useTranslation();
  const PRIORITY_OPTIONS = [
    { value: "low", label: t('tasks.priorityLow') },
    { value: "medium", label: t('tasks.priorityMedium') },
    { value: "high", label: t('tasks.priorityHigh') },
    { value: "critical", label: t('tasks.priorityCritical') },
  ];
  const CATEGORY_OPTIONS = [
    { value: "incident", label: t('tasks.categoryIncident') },
    { value: "change", label: t('tasks.categoryChange') },
    { value: "maintenance", label: t('tasks.categoryMaintenance') },
    { value: "deployment", label: t('tasks.categoryDeployment') },
    { value: "support", label: t('tasks.categorySupport') },
    { value: "other", label: t('tasks.categoryOther') },
  ];
  const count = selectedIds.size;
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (count === 0) return null;

  const handleUpdate = async (patch: Parameters<typeof onBulkUpdate>[0]) => {
    await onBulkUpdate(patch);
    setOpenPopover(null);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-card border border-border rounded-xl shadow-2xl shadow-black/20 animate-in slide-in-from-bottom-4 duration-200">
      {/* Count + clear */}
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <CheckSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t('tasks.bulkSelected', { count })}</span>
        <button
          onClick={onClear}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t('tasks.clearSelection')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Assign to */}
      <Popover
        open={openPopover === "assignee"}
        onOpenChange={(o) => setOpenPopover(o ? "assignee" : null)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={isPending}
          >
            <UserCheck className="w-3.5 h-3.5" />
            Assign to
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-1" align="center" side="top">
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => handleUpdate({ assignee: null })}
              className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-muted-foreground"
            >
              Unassign
            </button>
            {assigneeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleUpdate({ assignee: opt.value })}
                className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Change status */}
      <Popover
        open={openPopover === "status"}
        onOpenChange={(o) => setOpenPopover(o ? "status" : null)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={isPending}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Status
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="center" side="top">
          <div className="flex flex-col gap-0.5">
            {stageOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleUpdate({ status: opt.value })}
                className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Change priority */}
      <Popover
        open={openPopover === "priority"}
        onOpenChange={(o) => setOpenPopover(o ? "priority" : null)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={isPending}
          >
            <Tag className="w-3.5 h-3.5" />
            Priority
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="center" side="top">
          <div className="flex flex-col gap-0.5">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleUpdate({ priority: opt.value })}
                className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Change category */}
      <Popover
        open={openPopover === "category"}
        onOpenChange={(o) => setOpenPopover(o ? "category" : null)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={isPending}
          >
            <Layers className="w-3.5 h-3.5" />
            Category
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="center" side="top">
          <div className="flex flex-col gap-0.5">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleUpdate({ category: opt.value })}
                className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Delete (admin only) */}
      {canDelete && (
        <>
          <div className="w-px h-6 bg-border" />
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">
                Delete {count}?
              </span>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={isPending}
                onClick={async () => {
                  await onBulkDelete();
                  setConfirmDelete(false);
                }}
              >
                {isPending ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
              disabled={isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TasksList() {
  const { t: term, ts } = useTerminology();
  const { t, i18n } = useTranslation();

  // Build translated option arrays
  const PRIORITY_OPTIONS = [
    { value: "low", label: t('tasks.priorityLow') },
    { value: "medium", label: t('tasks.priorityMedium') },
    { value: "high", label: t('tasks.priorityHigh') },
    { value: "critical", label: t('tasks.priorityCritical') },
  ];

  const CATEGORY_OPTIONS = [
    { value: "incident", label: t('tasks.categoryIncident') },
    { value: "change", label: t('tasks.categoryChange') },
    { value: "maintenance", label: t('tasks.categoryMaintenance') },
    { value: "deployment", label: t('tasks.categoryDeployment') },
    { value: "support", label: t('tasks.categorySupport') },
    { value: "other", label: t('tasks.categoryOther') },
  ];
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const defaultApplied = useRef(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const {
    filters,
    setFilter,
    setSearch,
    setWatching,
    setSlaBreached,
    setStageType,
    setOverdue,
    setCustomFieldFilter,
    clearAll,
    applyView,
    hasActiveFilters,
    activeViewId,
  } = useTaskFilters();
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  // Parse the ?ids= param set by the custom-field conflict warning's "View affected tasks" link.
  // When present, the task list is narrowed to only the listed task IDs.
  const preFilterIds = (() => {
    const raw = new URLSearchParams(urlSearch).get("ids");
    if (!raw) return null;
    const ids = raw
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0);
    return ids.length > 0 ? new Set(ids) : null;
  })();

  const clearIdsFilter = useCallback(() => {
    const next = new URLSearchParams(urlSearch);
    next.delete("ids");
    setLocation("?" + next.toString(), { replace: true });
  }, [urlSearch, setLocation]);
  const queryClient = useQueryClient();

  // Build API query params from active filters (server-side filtering)
  // `watching` is not in the generated ListTasksQueryParams type so we cast.
  const apiParams = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(filters.watching ? { watching: "true" } : {}),
    ...(filters.slaBreached ? { slaBreached: "true" } : {}),
    ...(filters.customFieldId
      ? { customFieldId: Number(filters.customFieldId) }
      : {}),
    ...(filters.customFieldId && filters.customFieldValue
      ? { customFieldValue: filters.customFieldValue }
      : {}),
  } as Parameters<typeof useListTasks>[0];

  const { data: tasks, isLoading } = useListTasks(
    Object.keys(apiParams ?? {}).length ? apiParams : undefined,
  );
  const { data: members } = useListOrgMembers();
  const { data: views } = useListViews();
  const { data: slaPolicies } = useGetSLAPolicies();
  const { data: stages = [] } = useListWorkflowStages();
  const { data: customFieldDefs = [] } = useListCustomFieldDefinitions();

  // Build dynamic status options from org stages
  const stageStatusOptions = stages
    .filter((s) => !s.archivedAt)
    .map((s) => ({ value: String(s.id), label: s.name }));
  const { data: templates = [] } = useListTaskTemplates();

  const bulkUpdate = useBulkUpdateTasks();
  const bulkDelete = useBulkDeleteTasks();
  const { hasPermission } = useOrgContext();

  // Default view loading: on mount, if no filters in URL, apply the user's default view
  useEffect(() => {
    if (defaultApplied.current) return;
    if (!views) return;
    const params = new URLSearchParams(urlSearch);
    const hasFilters = params.size > 0;
    if (!hasFilters) {
      const defaultView = views.find(
        (v) => v.isDefault && v.createdBy === user?.id,
      );
      if (defaultView) {
        defaultApplied.current = true;
        applyView(defaultView);
      }
    } else {
      defaultApplied.current = true;
    }
  }, [views, urlSearch, applyView, user?.id]);

  // Today's date string for overdue comparison (YYYY-MM-DD)
  const todayStr = new Date().toISOString().split("T")[0];

  // Client-side: text search + project filter + stageType + overdue + optional pre-filter by specific task IDs
  const filteredTasks = tasks?.filter((t) => {
    // When ?ids= is present (e.g. from the custom-field conflict warning), narrow to those tasks
    if (preFilterIds && !preFilterIds.has(t.id)) return false;

    // Stage-type filter (open / closed)
    if (filters.stageType) {
      if (t.stageType !== filters.stageType) return false;
    }

    // Overdue: open stage AND (past due date OR critical priority)
    if (filters.overdue) {
      const isPastDue = !!t.dueDate && t.dueDate < todayStr;
      const isCritical = t.priority === "critical";
      if (t.stageType !== "open" || (!isPastDue && !isCritical)) return false;
    }

    const searchTerm = filters.search.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      t.title.toLowerCase().includes(searchTerm) ||
      (t.projectName && t.projectName.toLowerCase().includes(searchTerm));
    if (!matchesSearch) return false;

    if (filters.projectFilter === "with_project") return !!t.projectId;
    if (filters.projectFilter === "no_project") return !t.projectId;
    return true;
  });

  // Assignee options: org members with emails
  const assigneeOptions = (members ?? [])
    .filter((m) => m.email)
    .map((m) => ({
      value: m.email!,
      label: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email!,
    }));

  // Human-readable labels for active filters
  const statusLabel =
    stageStatusOptions.find((o) => o.value === filters.status)?.label ??
    stages.find((s) => String(s.id) === filters.status)?.name;
  const priorityLabel = PRIORITY_OPTIONS.find(
    (o) => o.value === filters.priority,
  )?.label;
  const categoryLabel = CATEGORY_OPTIONS.find(
    (o) => o.value === filters.category,
  )?.label;
  const assigneeLabel =
    assigneeOptions.find((o) => o.value === filters.assignee)?.label ??
    filters.assignee;

  const dueDateLabel =
    filters.dateFrom || filters.dateTo
      ? [
          filters.dateFrom && `From ${filters.dateFrom}`,
          filters.dateTo && `To ${filters.dateTo}`,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;

  // Custom-field filter: only non-deleted definitions
  const activeCustomFields = customFieldDefs.filter((f) => !f.deletedAt);
  const activeCustomField = filters.customFieldId
    ? (activeCustomFields.find((f) => String(f.id) === filters.customFieldId) ??
      null)
    : null;
  const isCustomFieldSelect =
    activeCustomField?.type === "single_select" ||
    activeCustomField?.type === "multi_select";
  const customFieldChipLabel = activeCustomField
    ? filters.customFieldValue
      ? `${activeCustomField.name}: ${filters.customFieldValue}`
      : `${activeCustomField.name}: any`
    : "Custom field";

  // ─── Selection helpers ────────────────────────────────────────────────────

  const visibleIds = (filteredTasks ?? []).map((t) => t.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleTask = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ─── Bulk action handlers ─────────────────────────────────────────────────

  const [blockedClose, setBlockedClose] = useState<BulkCloseBlockedTask[] | null>(null);
  const { toast } = useToast();

  const handleBulkUpdate = async (patch: {
    status?: string;
    priority?: string;
    category?: string;
    assignee?: string | null;
  }) => {
    try {
      await doBulkUpdate(patch);
    } catch (err: unknown) {
      // ApiError exposes .status and .data directly (not .response.*)
      const apiErr = err as { status?: number; data?: { blocked?: BulkCloseBlockedTask[] } };
      if (apiErr?.status === 422 && Array.isArray(apiErr.data?.blocked) && apiErr.data.blocked.length > 0) {
        setBlockedClose(apiErr.data.blocked);
        return;
      }
      const msg = (apiErr as { data?: { error?: string } })?.data?.error;
      toast({ title: msg ?? t('tasks.bulkUpdateFailed'), variant: "destructive" });
    }
  };

  const doBulkUpdate = async (patch: {
    status?: string;
    priority?: string;
    category?: string;
    assignee?: string | null;
  }) => {
    await bulkUpdate.mutateAsync({
      data: {
        ids: Array.from(selectedIds),
        patch: patch as {
          status?: "todo" | "in_progress" | "blocked" | "done";
          priority?: "low" | "medium" | "high" | "critical";
          category?:
            | "incident"
            | "change"
            | "maintenance"
            | "deployment"
            | "support"
            | "other";
          assignee?: string | null;
        },
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    clearSelection();
  };

  const handleBulkDelete = async () => {
    await bulkDelete.mutateAsync({
      data: { ids: Array.from(selectedIds) },
    });
    await queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    clearSelection();
  };

  const canDelete = hasPermission("delete_tasks");

  const isBulkPending = bulkUpdate.isPending || bulkDelete.isPending;

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {term("tasks")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('tasks.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <Popover
              open={showTemplatePicker}
              onOpenChange={setShowTemplatePicker}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <FileText className="w-4 h-4" />
                  {t('tasks.applyTemplate')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-1" align="end">
                <div className="flex flex-col gap-0.5">
                  {templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        setShowTemplatePicker(false);
                        setLocation(`/tasks/new?templateId=${tmpl.id}`);
                      }}
                      className="w-full text-left px-3 py-2 text-xs rounded-sm hover:bg-muted transition-colors"
                    >
                      <p className="font-medium">{tmpl.name}</p>
                      <p className="text-muted-foreground mt-0.5 capitalize">
                        {tmpl.defaultPriority} · {tmpl.defaultCategory}
                      </p>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            className="gap-2"
            data-testid="button-create-task"
            onClick={() => setLocation("/tasks/new")}
          >
            <Plus className="w-4 h-4" />
            {t('tasks.newTask', { task: ts("tasks") })}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 bg-card p-2 rounded-lg border border-border shadow-sm">
        {/* Search + view controls row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('tasks.searchTasks', { tasks: term("tasks").toLowerCase() })}
              className="pl-9 bg-background/50 border-transparent focus-visible:border-primary"
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 items-center">
            {/* View toggle */}
            <div className="bg-background/50 flex p-1 rounded-md border border-border">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="w-8 h-8 rounded-sm"
                onClick={() => setViewMode("list")}
              >
                <LayoutList className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "board" ? "secondary" : "ghost"}
                size="icon"
                className="w-8 h-8 rounded-sm"
                onClick={() => setViewMode("board")}
              >
                <Columns className="w-4 h-4" />
              </Button>
            </div>

            {/* Save view */}
            <SaveViewPopover
              filters={filters}
              activeViewId={activeViewId}
              views={views ?? []}
              userId={user?.id}
            />
          </div>
        </div>

        {/* Filter bar row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Project segment filter */}
          <div className="bg-background/50 flex p-1 rounded-md border border-border">
            {getProjectFilterOptions(term, ts, t).map((opt) => (
              <button
                key={opt.value}
                onClick={() =>
                  setFilter(
                    "projectFilter",
                    opt.value === "all" ? "" : opt.value,
                  )
                }
                className={`px-3 h-7 text-xs rounded-sm font-medium transition-colors ${
                  filters.projectFilter === opt.value
                    ? "bg-secondary text-secondary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Status chip */}
          <FilterChip
            label={t('tasks.filterByStatus')}
            value={filters.status}
            activeLabel={statusLabel ?? filters.status}
            onClear={() => setFilter("status", "")}
          >
            <OptionList
              options={stageStatusOptions}
              value={filters.status}
              onChange={(v) => setFilter("status", v)}
            />
          </FilterChip>

          {/* Priority chip */}
          <FilterChip
            label={t('tasks.filterByPriority')}
            value={filters.priority}
            activeLabel={priorityLabel ?? filters.priority}
            onClear={() => setFilter("priority", "")}
          >
            <OptionList
              options={PRIORITY_OPTIONS}
              value={filters.priority}
              onChange={(v) => setFilter("priority", v)}
            />
          </FilterChip>

          {/* Category chip */}
          <FilterChip
            label={t('tasks.filterByCategory')}
            value={filters.category}
            activeLabel={categoryLabel ?? filters.category}
            onClear={() => setFilter("category", "")}
          >
            <OptionList
              options={CATEGORY_OPTIONS}
              value={filters.category}
              onChange={(v) => setFilter("category", v)}
            />
          </FilterChip>

          {/* Assignee chip */}
          <FilterChip
            label={t('tasks.filterByAssignee')}
            value={filters.assignee}
            activeLabel={assigneeLabel}
            onClear={() => setFilter("assignee", "")}
          >
            {assigneeOptions.length > 0 ? (
              <OptionList
                options={assigneeOptions}
                value={filters.assignee}
                onChange={(v) => setFilter("assignee", v)}
              />
            ) : (
              <p className="text-xs text-muted-foreground px-3 py-2">
                No members found
              </p>
            )}
          </FilterChip>

          {/* Due date range chip */}
          <FilterChip
            label={t('tasks.filterByDate')}
            value={filters.dateFrom || filters.dateTo}
            activeLabel={dueDateLabel ?? t('tasks.filterByDate')}
            onClear={() => {
              setFilter("dateFrom", "");
              setFilter("dateTo", "");
            }}
          >
            <div className="flex flex-col gap-2 p-1">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  From
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilter("dateFrom", e.target.value)}
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  To
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilter("dateTo", e.target.value)}
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                />
              </div>
            </div>
          </FilterChip>

          {/* Stage-type filter */}
          <div className="flex items-center rounded-md border border-border overflow-hidden text-xs font-medium">
            {(["open", "closed"] as const).map((type) => (
              <button
                key={type}
                onClick={() =>
                  setStageType(filters.stageType === type ? "" : type)
                }
                className={`px-3 h-8 capitalize transition-colors ${
                  filters.stageType === type
                    ? type === "open"
                      ? "bg-primary text-primary-foreground"
                      : "bg-emerald-600 text-white"
                    : "bg-background/50 text-muted-foreground hover:text-foreground hover:bg-background"
                }`}
                title={
                  filters.stageType === type
                    ? t('tasks.stageFilterActive', { type: type === 'open' ? t('common.open') : t('common.closed'), tasks: term("tasks").toLowerCase() })
                    : t('tasks.stageFilter', { type: type === 'open' ? t('common.open') : t('common.closed'), tasks: term("tasks").toLowerCase() })
                }
              >
                {type === 'open' ? t('common.open') : t('common.closed')}
              </button>
            ))}
          </div>

          {/* Overdue toggle */}
          <button
            onClick={() => setOverdue(!filters.overdue)}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md font-medium border transition-colors ${
              filters.overdue
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-background/50 text-muted-foreground border-border hover:text-foreground hover:bg-background"
            }`}
            title={
              filters.overdue
                ? `Showing overdue / critical ${term("tasks").toLowerCase()} - click to clear`
                : `Show overdue or critical priority ${term("tasks").toLowerCase()}`
            }
          >
            <Clock className="w-3.5 h-3.5" />
            {t('tasks.overdue')}
          </button>

          {/* SLA Breached toggle - hidden when sla_tracking is off */}
          <FeatureGate feature="sla_tracking" compact>
            <button
              onClick={() => setSlaBreached(!filters.slaBreached)}
              className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md font-medium border transition-colors ${
                filters.slaBreached
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-background/50 text-muted-foreground border-border hover:text-foreground hover:bg-background"
              }`}
              title={
                filters.slaBreached
                  ? t('tasks.slaFilterActive', { tasks: term("tasks").toLowerCase() })
                  : t('tasks.slaFilter', { tasks: term("tasks").toLowerCase() })
              }
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {t('tasks.slaBreached')}
            </button>
          </FeatureGate>

          {/* Watching toggle */}
          <button
            onClick={() => setWatching(!filters.watching)}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-md font-medium border transition-colors ${
              filters.watching
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background/50 text-muted-foreground border-border hover:text-foreground hover:bg-background"
            }`}
            title={
              filters.watching
                ? `Showing only watched ${term("tasks").toLowerCase()} - click to clear`
                : `Show only ${term("tasks").toLowerCase()} you're watching`
            }
          >
            <Eye className="w-3.5 h-3.5" />
            {t('tasks.watching')}
          </button>

          {/* Custom field filter chip - only rendered when org has custom fields */}
          {activeCustomFields.length > 0 && (
            <Popover>
              <div className="flex items-center">
                <PopoverTrigger asChild>
                  <button
                    className={`flex items-center gap-1.5 px-3 h-8 text-xs rounded-l-md font-medium border transition-colors ${
                      filters.customFieldId
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background/50 text-muted-foreground border-border hover:text-foreground hover:bg-background"
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    {customFieldChipLabel}
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>
                </PopoverTrigger>
                {filters.customFieldId && (
                  <button
                    onClick={() => setCustomFieldFilter("", "")}
                    className="flex items-center justify-center w-6 h-8 rounded-r-md border border-l-0 border-primary bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
                    aria-label={t("tasks.clearCustomFieldFilter")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {!filters.customFieldId && <div className="w-0 border-r-0" />}
              </div>
              <PopoverContent className="w-52 p-1" align="start">
                {!filters.customFieldId ? (
                  /* Step 1 - pick a field */
                  <div className="flex flex-col gap-0.5">
                    <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                      Pick a field
                    </p>
                    {activeCustomFields.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setCustomFieldFilter(String(f.id), "")}
                        className="w-full text-left px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors"
                      >
                        {f.name}
                        <span className="ml-1.5 text-muted-foreground capitalize text-[10px]">
                          {f.type.replace("_", " ")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  /* Step 2 - pick a value (select types) or confirm (others) */
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => setCustomFieldFilter("", "")}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Back
                    </button>
                    <p className="px-2 pb-1 text-xs font-medium truncate">
                      {activeCustomField?.name}
                    </p>
                    {isCustomFieldSelect && activeCustomField?.options ? (
                      (activeCustomField.options as string[]).map((opt) => (
                        <button
                          key={opt}
                          onClick={() =>
                            setCustomFieldFilter(
                              filters.customFieldId,
                              filters.customFieldValue === opt ? "" : opt,
                            )
                          }
                          className={`w-full text-left px-3 py-1.5 text-xs rounded-sm transition-colors ${
                            filters.customFieldValue === opt
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          {opt}
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-1.5 text-xs text-muted-foreground">
                        {t('tasks.noTasks', { tasks: term("tasks") })}
                      </p>
                    )}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 px-3 h-8 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
              {t('tasks.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {/* Pre-filter banner - shown when the task list is scoped to specific IDs (e.g. from the custom-field conflict warning) */}
      {preFilterIds && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
          <span className="text-primary font-medium">
            Showing {preFilterIds.size} task{preFilterIds.size === 1 ? "" : "s"}{" "}
            that use a removed custom-field option
          </span>
          <button
            onClick={clearIdsFilter}
            className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary transition-colors"
          >
            <X className="w-3 h-3" />
            Clear filter
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
          </div>
        ) : viewMode === "list" ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {/* Header row with select-all checkbox */}
              {filteredTasks && filteredTasks.length > 0 && (
                <div className="px-4 py-2 flex items-center gap-3 bg-muted/20">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border cursor-pointer accent-primary"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={t('tasks.bulkSelect')}
                  />
                  <span className="text-xs text-muted-foreground font-medium">
                    {someSelected
                      ? t('tasks.selectedCount', { count: selectedIds.size })
                      : `${filteredTasks.length} ${filteredTasks.length === 1 ? ts("tasks") : term("tasks")}`}
                  </span>
                </div>
              )}

              {filteredTasks && filteredTasks.length > 0 ? (
                filteredTasks.map((task) => {
                  const isChecked = selectedIds.has(task.id);
                  const anySelected = selectedIds.size > 0;
                  return (
                    <div
                      key={task.id}
                      className={`group p-4 hover:bg-muted/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 ${isChecked ? "bg-primary/5" : ""}`}
                    >
                      {/* Checkbox - always visible when something is selected, hover-visible otherwise */}
                      <div
                        className={`flex items-start gap-3 ${anySelected ? "" : "group-hover:[&>input]:opacity-100"}`}
                      >
                        <input
                          type="checkbox"
                          className={`mt-0.5 w-4 h-4 rounded border-border cursor-pointer accent-primary flex-shrink-0 transition-opacity ${anySelected || isChecked ? "opacity-100" : "opacity-0"}`}
                          checked={isChecked}
                          onChange={() => toggleTask(task.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${ts("tasks")} ${task.title}`}

                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
                              TSK-{task.orgTaskNumber}
                            </span>
                            <Link href={`/tasks/${task.id}`}>
                              <span className="font-medium text-sm hover:text-primary transition-colors cursor-pointer">
                                {task.title}
                              </span>
                            </Link>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {task.projectName && (
                              <span className="text-foreground/80">
                                {task.projectName}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded border border-border">
                              {({ incident: t('tasks.categoryIncident' as any), change: t('tasks.categoryChange' as any), maintenance: t('tasks.categoryMaintenance' as any), deployment: t('tasks.categoryDeployment' as any), support: t('tasks.categorySupport' as any), other: t('tasks.categoryOther' as any) } as Record<string, string>)[task.category] ?? task.category}
                            </span>
                            {task.dueDate && (
                              <span>Due: {formatDate(task.dueDate, i18n.language)}</span>
                            )}
                            {task.assignee && (
                              <span className="flex items-center gap-1">
                                <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] text-primary">
                                  {task.assignee.charAt(0).toUpperCase()}
                                </div>
                                {task.assignee}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-7 md:pl-0 flex-wrap justify-end">
                        <FeatureGate feature="sla_tracking" compact>
                          <SlaBadge
                            createdAt={task.createdAt}
                            updatedAt={task.updatedAt}
                            status={task.status}
                            priority={task.priority}
                            policies={slaPolicies}
                            stageType={
                              task.stageType as "open" | "closed" | undefined
                            }
                          />
                        </FeatureGate>
                        <StatusBadge
                          status={task.status}
                          stageName={task.stageName}
                          stageColor={task.stageColor}
                          stageArchived={task.stageArchived}
                        />
                        <PriorityBadge priority={task.priority} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  {t('tasks.noTasks', { tasks: term("tasks") })}
                </div>
              )}
            </div>
          </Card>
        ) : (
          <KanbanBoard tasks={filteredTasks ?? []} stages={stages} />
        )}
      </div>

      {/* Floating bulk action bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClear={clearSelection}
        assigneeOptions={assigneeOptions}
        canDelete={canDelete}
        onBulkUpdate={handleBulkUpdate}
        onBulkDelete={handleBulkDelete}
        isPending={isBulkPending}
        stageOptions={stageStatusOptions}
      />

      {/* Blocked bulk-close dialog */}
      <Dialog open={blockedClose !== null} onOpenChange={(open) => { if (!open) setBlockedClose(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-500" />
              {t('tasks.bulkBlockedTitle')}
            </DialogTitle>
            <DialogDescription>{t('tasks.bulkBlockedDesc')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-3">
            {(blockedClose ?? []).map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">
                  TSK-{b.orgTaskNumber} · {b.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">{t('tasks.bulkBlockedBy')}</p>
                <ul className="mt-1 space-y-1">
                  {b.openParents.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/tasks/${p.id}`}
                        className="text-sm text-primary hover:underline"
                        onClick={() => setBlockedClose(null)}
                      >
                        TSK-{p.orgTaskNumber} · {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockedClose(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                const parentIds = new Set(
                  (blockedClose ?? []).flatMap((b) => b.openParents.map((p) => p.id)),
                );
                setSelectedIds(parentIds);
                setBlockedClose(null);
              }}
            >
              {t('tasks.bulkCloseParentsFirst')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewTaskModal
        open={showNewTask}
        onOpenChange={(open) => {
          setShowNewTask(open);
          if (!open) setTemplateForModal(undefined);
        }}
        initialTemplate={templateForModal}
      />
    </div>
  );
}
