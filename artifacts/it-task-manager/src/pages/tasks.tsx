import { useListTasks, useListOrgMembers } from "@workspace/api-client-react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { Plus, Search, LayoutList, Columns, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useCallback } from "react";
import { NewTaskModal } from "@/components/ui/new-task-modal";
import { KanbanBoard } from "@/components/ui/kanban-board";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const CATEGORY_OPTIONS = [
  { value: "incident", label: "Incident" },
  { value: "change", label: "Change" },
  { value: "maintenance", label: "Maintenance" },
  { value: "deployment", label: "Deployment" },
  { value: "support", label: "Support" },
  { value: "other", label: "Other" },
];

const PROJECT_FILTER_OPTIONS: { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All Tasks" },
  { value: "with_project", label: "In a Project" },
  { value: "no_project", label: "No Project" },
];

// ─── URL state hook ───────────────────────────────────────────────────────────

function useTaskFilters() {
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
  };

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

  const clearAll = useCallback(() => {
    setLocation("?", { replace: true });
  }, [setLocation]);

  const hasActiveFilters =
    !!filters.status ||
    !!filters.priority ||
    !!filters.category ||
    !!filters.assignee ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  return { filters, setFilter, clearAll, hasActiveFilters };
}

// ─── Filter chip component ────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  value: string;
  activeLabel?: string;
  children: React.ReactNode;
  onClear: () => void;
}

function FilterChip({ label, value, activeLabel, children, onClear }: FilterChipProps) {
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
            {isActive ? activeLabel ?? label : label}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </PopoverTrigger>
        {isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="flex items-center justify-center w-6 h-8 rounded-r-md border border-l-0 border-primary bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
            aria-label={`Clear ${label} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {!isActive && (
          <div className="w-0 border-r-0" />
        )}
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TasksList() {
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [search, setSearch] = useState("");
  const [showNewTask, setShowNewTask] = useState(false);

  const { filters, setFilter, clearAll, hasActiveFilters } = useTaskFilters();

  // Build API query params from active filters (server-side filtering)
  const apiParams = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  };

  const { data: tasks, isLoading } = useListTasks(
    Object.keys(apiParams).length ? apiParams : undefined,
  );
  const { data: members } = useListOrgMembers();

  // Client-side: text search + project filter (not API-level)
  const filteredTasks = tasks?.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.projectName && t.projectName.toLowerCase().includes(search.toLowerCase()));
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
      label:
        [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email!,
    }));

  // Human-readable labels for active filters
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === filters.status)?.label;
  const priorityLabel = PRIORITY_OPTIONS.find((o) => o.value === filters.priority)?.label;
  const categoryLabel = CATEGORY_OPTIONS.find((o) => o.value === filters.category)?.label;
  const assigneeLabel =
    assigneeOptions.find((o) => o.value === filters.assignee)?.label ?? filters.assignee;

  const dueDateLabel = filters.dateFrom || filters.dateTo
    ? [filters.dateFrom && `From ${filters.dateFrom}`, filters.dateTo && `To ${filters.dateTo}`]
        .filter(Boolean)
        .join(" ")
    : undefined;

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-1">Manage incidents, changes, and operational work.</p>
        </div>
        <Button className="gap-2" data-testid="button-create-task" onClick={() => setShowNewTask(true)}>
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 bg-card p-2 rounded-lg border border-border shadow-sm">
        {/* Search + view controls row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks, tickets, projects..."
              className="pl-9 bg-background/50 border-transparent focus-visible:border-primary"
              value={search}
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
          </div>
        </div>

        {/* Filter bar row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Project segment filter */}
          <div className="bg-background/50 flex p-1 rounded-md border border-border">
            {PROJECT_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter("projectFilter", opt.value === "all" ? "" : opt.value)}
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
            label="Status"
            value={filters.status}
            activeLabel={statusLabel ?? filters.status}
            onClear={() => setFilter("status", "")}
          >
            <OptionList
              options={STATUS_OPTIONS}
              value={filters.status}
              onChange={(v) => setFilter("status", v)}
            />
          </FilterChip>

          {/* Priority chip */}
          <FilterChip
            label="Priority"
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
            label="Category"
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
            label="Assignee"
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
              <p className="text-xs text-muted-foreground px-3 py-2">No members found</p>
            )}
          </FilterChip>

          {/* Due date range chip */}
          <FilterChip
            label="Due date"
            value={filters.dateFrom || filters.dateTo}
            activeLabel={dueDateLabel ?? "Due date"}
            onClear={() => { setFilter("dateFrom", ""); setFilter("dateTo", ""); }}
          >
            <div className="flex flex-col gap-2 p-1">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilter("dateFrom", e.target.value)}
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilter("dateTo", e.target.value)}
                  className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                />
              </div>
            </div>
          </FilterChip>

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 px-3 h-8 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : viewMode === "list" ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {filteredTasks && filteredTasks.length > 0 ? (
                filteredTasks.map((task) => (
                  <div key={task.id} className="p-4 hover:bg-muted/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pl-14 md:pl-0">
                        {task.projectName && (
                          <span className="text-foreground/80">{task.projectName}</span>
                        )}
                        <span className="px-1.5 py-0.5 rounded border border-border">
                          {task.category}
                        </span>
                        {task.dueDate && (
                          <span>Due: {formatDate(task.dueDate)}</span>
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
                    <div className="flex items-center gap-2 pl-14 md:pl-0">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  No tasks found matching your criteria.
                </div>
              )}
            </div>
          </Card>
        ) : (
          <KanbanBoard tasks={filteredTasks ?? []} />
        )}
      </div>

      <NewTaskModal open={showNewTask} onOpenChange={setShowNewTask} />
    </div>
  );
}
