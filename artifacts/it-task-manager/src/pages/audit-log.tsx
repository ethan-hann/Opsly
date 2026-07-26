import { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { useSearchParams } from "wouter";
import { useGetOrgAuditLog, getGetOrgAuditLogQueryKey, type AuditEvent } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, RefreshCw, AlertTriangle, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditCategory =
  | "member"
  | "project"
  | "webhook"
  | "role"
  | "settings"
  | "custom_field"
  | "workflow"
  | "task";

// ─── Category badge styling ───────────────────────────────────────────────────

const CATEGORY_VARIANT: Record<AuditCategory, "default" | "secondary" | "outline" | "destructive"> = {
  member: "default",
  project: "secondary",
  webhook: "outline",
  role: "outline",
  settings: "secondary",
  custom_field: "outline",
  workflow: "secondary",
  task: "default",
};

function getCategoryLabel(t: (k: string) => string, cat: AuditCategory): string {
  const map: Record<AuditCategory, string> = {
    member: t('auditLog.categoryMember'),
    project: t('auditLog.categoryProject'),
    webhook: t('auditLog.categoryWebhook'),
    role: t('auditLog.categoryRole'),
    settings: t('auditLog.categorySettings'),
    custom_field: t('auditLog.categoryCustomField'),
    workflow: t('auditLog.categoryWorkflow'),
    task: t('auditLog.categoryTask'),
  };
  return map[cat] ?? cat;
}

// ─── URL filter helpers ───────────────────────────────────────────────────────
//
// useLocation() from wouter only returns the pathname — it never includes the
// query string, so reading filters from it always yields empty strings.
// useSearchParams() is the correct reactive hook for query-string state.

function useAuditFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const actor = searchParams.get("actor") ?? "";
  const category = (searchParams.get("category") as AuditCategory | null) ?? "";

  const setFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());

  return { from, to, actor, category, setFilter, clearFilters };
}

// ─── Access denied ────────────────────────────────────────────────────────────

function AccessDenied() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertTriangle className="w-12 h-12 text-muted-foreground/40" />
      <h2 className="text-lg font-semibold">{t('auditLog.accessDenied')}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {t('auditLog.accessDeniedDescPre')}{" "}
        <code className="text-xs bg-muted px-1 py-0.5 rounded">view_audit_log</code>{" "}
        {t('auditLog.accessDeniedDescPost')}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const { hasPermission } = useOrgContext();
  if (!hasPermission("view_audit_log")) return <AccessDenied />;
  return <AuditLogContent />;
}

// ─── Content ──────────────────────────────────────────────────────────────────

function AuditLogContent() {
  const { t } = useTranslation();
  const { from, to, actor, category, setFilter, clearFilters } = useAuditFilters();
  const { hasPermission } = useOrgContext();

  // allEvents accumulates across Load More presses.
  const [allEvents, setAllEvents] = useState<AuditEvent[]>([]);
  // nextCursor tracks the keyset cursor for the upcoming Load More request.
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  // loadingMore tracks manual Load More fetch state.
  const [loadingMore, setLoadingMore] = useState(false);

  // filterKey changes whenever filters change, used to reset accumulation.
  const filterKey = `${from}|${to}|${actor}|${category}`;
  const prevFilterKey = useRef(filterKey);

  // Query params for the first page (no cursor).
  const queryParams = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actor ? { actor } : {}),
    ...(category ? { category: category as AuditCategory } : {}),
    limit: 50,
  };

  const { data, isLoading, isError, refetch, isFetching } = useGetOrgAuditLog(
    queryParams,
    {
      query: { queryKey: getGetOrgAuditLogQueryKey(queryParams), enabled: hasPermission("view_audit_log") },
    },
  );

  // When filter params change, reset accumulated events and cursor.
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setAllEvents([]);
      setNextCursor(undefined);
    }
  }, [filterKey]);

  // When the first-page data arrives (or changes due to a refetch), reset
  // accumulation to match the fresh page.
  useEffect(() => {
    if (data) {
      setAllEvents(data.events ?? []);
      setNextCursor(data.nextCursor ?? null);
    }
  }, [data]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleFilterChange = (key: string, value: string) => {
    setFilter(key, value);
    // Accumulation reset is handled by the filterKey effect above.
  };

  const handleClearFilters = () => clearFilters();

  const handleRefresh = () => {
    setAllEvents([]);
    setNextCursor(undefined);
    void refetch();
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({
        limit: "50",
        cursor: nextCursor,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(actor ? { actor } : {}),
        ...(category ? { category } : {}),
      });
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const res = await fetch(`${base}/api/org/audit-log?${p.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const page = await res.json() as { events: AuditEvent[]; nextCursor: string | null };
      setAllEvents((prev) => [...prev, ...(page.events ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const hasFilters = !!(from || to || actor || category);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('auditLog.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('auditLog.filter')}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isFetching || loadingMore}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-muted-foreground">{t('auditLog.timestamp')}</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => handleFilterChange("from", e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-muted-foreground">{t('auditLog.timestamp')}</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => handleFilterChange("to", e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground">{t('auditLog.actor')}</label>
          <Input
            placeholder={t('common.search') + "..."}
            value={actor}
            onChange={(e) => handleFilterChange("actor", e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-medium text-muted-foreground">{t('auditLog.filter')}</label>
          <Select
            value={category || "all"}
            onValueChange={(v) => handleFilterChange("category", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={t('auditLog.categoryAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('auditLog.categoryAll')}</SelectItem>
              <SelectItem value="member">{t('auditLog.categoryMember')}</SelectItem>
              <SelectItem value="project">{t('auditLog.categoryProject')}</SelectItem>
              <SelectItem value="webhook">{t('auditLog.categoryWebhook')}</SelectItem>
              <SelectItem value="role">{t('auditLog.categoryRole')}</SelectItem>
              <SelectItem value="settings">{t('auditLog.categorySettings')}</SelectItem>
              <SelectItem value="custom_field">{t('auditLog.categoryCustomField')}</SelectItem>
              <SelectItem value="workflow">{t('auditLog.categoryWorkflow')}</SelectItem>
              <SelectItem value="task">{t('auditLog.categoryTask')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={handleClearFilters}
          >
            {t('common.clear')}
          </Button>
        )}
      </div>

      {/* Events table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive/60" />
          <p className="text-sm text-muted-foreground">{t('auditLog.failedToLoad')}</p>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap">{t('auditLog.timestamp')}</th>
                  <th className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap">{t('common.type')}</th>
                  <th className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap">{t('auditLog.actor')}</th>
                  <th className="px-4 py-3 text-left font-medium text-xs">{t('auditLog.details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ScrollText className="w-8 h-8 opacity-30" />
                        <p className="text-sm">{t('auditLog.noEntries')}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  allEvents.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
              >
                <ChevronDown className={`w-4 h-4 mr-2 ${loadingMore ? "animate-spin" : ""}`} />
                {loadingMore ? t('common.loading') : t('common.viewAll')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: AuditEvent }) {
  const { t, i18n } = useTranslation();
  const cat = event.category as AuditCategory;
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap font-mono">
        {new Date(event.createdAt).toLocaleString(i18n.language || undefined)}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <Badge variant={CATEGORY_VARIANT[cat] ?? "outline"} className="text-xs">
          {getCategoryLabel(t, cat)}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {event.actorName ? (
          <span className="bg-muted px-1.5 py-0.5 rounded text-foreground">
            {event.actorName}
          </span>
        ) : (
          <span className="italic opacity-50">{t('common.system')}</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <span>{event.description}</span>
        {event.targetId && event.source === "task" && (
          <a
            href={`${base}/tasks/${event.targetId}`}
            className="ml-2 text-xs text-primary hover:underline"
          >
            {t('auditLog.viewTask')}
          </a>
        )}
      </td>
    </tr>
  );
}
