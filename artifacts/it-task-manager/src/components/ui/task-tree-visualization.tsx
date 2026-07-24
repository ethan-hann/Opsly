/**
 * TaskTreeVisualization — builds and renders the task dependency tree.
 *
 * Two modes:
 *   Full mode  (focusedTaskId absent): all project tasks, all branches expanded.
 *               Includes an inline "Link tasks" form to create new dependency edges.
 *   Focused mode (focusedTaskId set):  anchored on the focused task; ancestors
 *               expanded, distant branches collapsed, focused node highlighted.
 *               "Add dependency" combobox picks the parent for the focused task.
 *
 * candidateTasks — optional full list of project tasks to use as the picker
 * pool. Defaults to `tasks`. In task-detail, pass all project tasks here so
 * the picker isn't limited to the tiny focused-task neighbourhood.
 */

import { useState, useMemo } from "react";
import { Plus, GitBranch, Link2 } from "lucide-react";
import { TaskTreeNode } from "./task-tree-node";
import type { TaskTreeItemData } from "./task-tree-node";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOrgContext } from "@/hooks/use-org-context";
import { useTerminology } from "@/context/terminology-context";
import { cn } from "@/lib/utils";

export interface TaskDependencyEdgeData {
  id: number;
  taskId: number;
  dependsOnTaskId: number;
}

interface TaskTreeVisualizationProps {
  /** Tasks to render in the tree */
  tasks: TaskTreeItemData[];
  /** Dependency edges */
  edges: TaskDependencyEdgeData[];
  /** When set, enables focused mode — this task is highlighted at centre */
  focusedTaskId?: number;
  /**
   * Full pool of project tasks available for the dependency picker.
   * Defaults to `tasks` when omitted. Pass all project tasks here so the
   * picker is not limited to the focused-task neighbourhood.
   */
  candidateTasks?: TaskTreeItemData[];
  /**
   * Called when the user adds a dependency.
   * taskId = the task that will be blocked (child / dependent)
   * dependsOnTaskId = the task it must wait for (parent / blocker)
   */
  onAddDependency?: (taskId: number, dependsOnTaskId: number) => void;
  /** Called when the user removes a dependency edge via the × button */
  onRemoveDependency?: (taskId: number, dependsOnTaskId: number) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeAncestors(
  taskId: number,
  parentMap: Map<number, number[]>,
): Set<number> {
  const ancestors = new Set<number>();
  const queue = [...(parentMap.get(taskId) ?? [])];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (!ancestors.has(curr)) {
      ancestors.add(curr);
      queue.push(...(parentMap.get(curr) ?? []));
    }
  }
  return ancestors;
}

// ─── Single-task dependency picker (focused mode) ────────────────────────────

function AddParentPicker({
  candidates,
  allCandidates,
  search,
  onSearchChange,
  open,
  onOpenChange,
  onAdd,
}: {
  candidates: TaskTreeItemData[];
  allCandidates: TaskTreeItemData[];
  search: string;
  onSearchChange: (v: string) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (taskId: number) => void;
}) {
  const { t: term } = useTerminology();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
          <Plus className="w-3.5 h-3.5" />
          Add dependency
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${term("tasks")}…`}
            value={search}
            onValueChange={onSearchChange}
          />
          <CommandList>
            {candidates.length === 0 ? (
              <CommandEmpty>
                {allCandidates.length === 0
                  ? `No available ${term("tasks")} to link.`
                  : `No ${term("tasks")} match your search.`}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {candidates.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.orgTaskNumber}-${t.title}`}
                    onSelect={() => onAdd(t.id)}
                    className="gap-2"
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      TSK-{t.orgTaskNumber}
                    </span>
                    <span className="truncate">{t.title}</span>
                    {t.isClosed && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        Closed
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Task picker (single combobox, reusable in the link form) ────────────────

function TaskPicker({
  placeholder,
  value,
  onChange,
  options,
  excludeIds,
}: {
  placeholder: string;
  value: number | null;
  onChange: (id: number | null) => void;
  options: TaskTreeItemData[];
  excludeIds?: Set<number>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = options.filter(
    (t) =>
      (!excludeIds || !excludeIds.has(t.id)) &&
      (search === "" ||
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        String(t.orgTaskNumber).includes(search)),
  );

  const selected = value != null ? options.find((t) => t.id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-sm",
            "hover:bg-muted/50 transition-colors min-w-[180px] max-w-[220px]",
            !selected && "text-muted-foreground",
          )}
        >
          {selected ? (
            <>
              <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                TSK-{selected.orgTaskNumber}
              </span>
              <span className="truncate">{selected.title}</span>
            </>
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>No tasks found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.orgTaskNumber}-${t.title}`}
                    onSelect={() => {
                      onChange(t.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="gap-2"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                      TSK-{t.orgTaskNumber}
                    </span>
                    <span className="truncate">{t.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── "Link tasks" inline form (full mode) ────────────────────────────────────

function LinkTasksForm({
  allTasks,
  onSubmit,
  onCancel,
}: {
  allTasks: TaskTreeItemData[];
  onSubmit: (taskId: number, dependsOnTaskId: number) => void;
  onCancel: () => void;
}) {
  const [childId, setChildId] = useState<number | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);

  const canSubmit = childId != null && parentId != null && childId !== parentId;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
      <TaskPicker
        placeholder="Task (blocked)"
        value={childId}
        onChange={setChildId}
        options={allTasks}
        excludeIds={parentId != null ? new Set([parentId]) : undefined}
      />
      <span className="text-muted-foreground text-xs shrink-0">depends on</span>
      <TaskPicker
        placeholder="Task (blocker)"
        value={parentId}
        onChange={setParentId}
        options={allTasks}
        excludeIds={childId != null ? new Set([childId]) : undefined}
      />
      <div className="flex items-center gap-1.5 ml-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit) {
              onSubmit(childId!, parentId!);
              setChildId(null);
              setParentId(null);
            }
          }}
        >
          <Plus className="w-3 h-3" />
          Add link
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TaskTreeVisualization({
  tasks,
  edges,
  focusedTaskId,
  candidateTasks,
  onAddDependency,
  onRemoveDependency,
}: TaskTreeVisualizationProps) {
  const { hasPermission } = useOrgContext();
  const { t: term } = useTerminology();
  const canLink = hasPermission("link_tasks");

  // Focused-mode picker state
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Full-mode link form state
  const [showLinkForm, setShowLinkForm] = useState(false);

  // Expand / Collapse all: bump treeKey to remount the tree with a new defaultExpanded.
  const [treeKey, setTreeKey] = useState(0);
  const [globalDefaultExpanded, setGlobalDefaultExpanded] = useState<boolean | null>(null);
  const expandAll = () => { setGlobalDefaultExpanded(true); setTreeKey((k) => k + 1); };
  const collapseAll = () => { setGlobalDefaultExpanded(false); setTreeKey((k) => k + 1); };

  // ── Build adjacency maps ──
  const { childrenMap, parentMap, allItems, rootIds, ancestorIds } =
    useMemo(() => {
      const allItems = new Map<number, TaskTreeItemData>(
        tasks.map((t) => [t.id, t]),
      );
      const childrenMap = new Map<number, number[]>();
      const parentMap = new Map<number, number[]>();
      for (const t of tasks) {
        childrenMap.set(t.id, []);
        parentMap.set(t.id, []);
      }
      for (const edge of edges) {
        const existing = childrenMap.get(edge.dependsOnTaskId) ?? [];
        existing.push(edge.taskId);
        childrenMap.set(edge.dependsOnTaskId, existing);

        const existingParents = parentMap.get(edge.taskId) ?? [];
        existingParents.push(edge.dependsOnTaskId);
        parentMap.set(edge.taskId, existingParents);
      }
      // Sort all children lists by ID so sibling order is deterministic regardless
      // of API response order.
      for (const [, childIds] of childrenMap) {
        childIds.sort((a, b) => a - b);
      }

      // Sort root IDs by task ID ascending so BFS order is deterministic.
      const rootIds = tasks
        .filter((t) => (parentMap.get(t.id) ?? []).length === 0)
        .sort((a, b) => a.id - b.id)
        .map((t) => t.id);

      const ancestorIds =
        focusedTaskId != null
          ? computeAncestors(focusedTaskId, parentMap)
          : new Set<number>();

      // The full childrenMap is used in both full mode and focused mode.
      // Full mode shows the complete DAG: tasks with multiple parents appear
      // under EACH parent (intentional — the project tree is a dependency graph
      // overview, not a deduplicated hierarchy).
      return { childrenMap, parentMap, allItems, rootIds, ancestorIds };
    }, [tasks, edges, focusedTaskId]);

  // Use the full childrenMap in both modes.
  const activeChildrenMap = childrenMap;

  // Visible roots in focused mode: only roots that lead to the focused task
  const visibleRootIds = useMemo(() => {
    if (focusedTaskId == null) return rootIds;
    return rootIds.filter(
      (id) => ancestorIds.has(id) || id === focusedTaskId,
    );
  }, [rootIds, focusedTaskId, ancestorIds]);

  // ── Candidate pool for pickers ──
  // Use candidateTasks (all project tasks) when provided; fall back to tasks.
  const pool = candidateTasks ?? tasks;

  // Focused-mode: candidates for "Add dependency" (parents for the focused task)
  const existingParentIds = new Set(
    edges
      .filter((e) => e.taskId === focusedTaskId)
      .map((e) => e.dependsOnTaskId),
  );
  const addCandidates = pool.filter(
    (t) => t.id !== focusedTaskId && !existingParentIds.has(t.id),
  );
  const filteredCandidates = addCandidates.filter(
    (t) =>
      search === "" ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      String(t.orgTaskNumber).includes(search),
  );

  // ── Empty states ──
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p>No {term("tasks")} in this scope.</p>
      </div>
    );
  }

  const renderRoots = focusedTaskId == null ? rootIds : visibleRootIds;
  const hasTree = edges.length > 0;

  return (
    <div className="space-y-2">
      {/* ── Toolbar: Link tasks (full mode) + Expand/Collapse all ── */}
      {hasTree && (
        <div className="flex items-center gap-2">
          {canLink && onAddDependency && focusedTaskId == null && (
            showLinkForm ? (
              <LinkTasksForm
                allTasks={pool}
                onSubmit={(taskId, dependsOnTaskId) => {
                  onAddDependency(taskId, dependsOnTaskId);
                  setShowLinkForm(false);
                }}
                onCancel={() => setShowLinkForm(false)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-8"
                onClick={() => setShowLinkForm(true)}
              >
                <Link2 className="w-3.5 h-3.5" />
                Link tasks
              </Button>
            )
          )}
          {/* Expand / Collapse all — always shown when there is a tree */}
          <div className="ml-auto flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
              onClick={collapseAll}
            >
              Collapse all
            </button>
            <span className="opacity-40">·</span>
            <button
              type="button"
              className="px-1.5 py-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
              onClick={expandAll}
            >
              Expand all
            </button>
          </div>
        </div>
      )}

      {/* Full-mode Link tasks control when there is no tree yet */}
      {!hasTree && canLink && onAddDependency && focusedTaskId == null && (
        <div className="pb-1">
          {showLinkForm ? (
            <LinkTasksForm
              allTasks={pool}
              onSubmit={(taskId, dependsOnTaskId) => {
                onAddDependency(taskId, dependsOnTaskId);
                setShowLinkForm(false);
              }}
              onCancel={() => setShowLinkForm(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => setShowLinkForm(true)}
            >
              <Link2 className="w-3.5 h-3.5" />
              Link tasks
            </Button>
          )}
        </div>
      )}

      {/* ── Empty tree hint ── */}
      {!hasTree && (
        <p className="text-xs text-muted-foreground pb-1">
          No dependencies linked yet.{focusedTaskId == null ? ' Use "Link tasks" to define the order ' + term("tasks") + ' must be completed.' : ''}
        </p>
      )}

      {/* ── Tree nodes ── */}
      {/*
        key={treeKey} remounts the whole tree when the user clicks Expand/Collapse all,
        forcing every TaskTreeNode to reinitialise its local `expanded` state from
        `defaultExpanded`.
      */}
      <div key={treeKey} className="space-y-0.5">
        {renderRoots.map((rootId) => {
          const rootItem = allItems.get(rootId);
          if (!rootItem) return null;
          const rootChildren = (activeChildrenMap.get(rootId) ?? [])
            .map((id) => allItems.get(id)!)
            .filter(Boolean);
          // defaultExpanded from global override, otherwise: expand all in full mode
          // and expand only ancestor branches + focused task in focused mode.
          const nodeDefaultExpanded = globalDefaultExpanded !== null
            ? globalDefaultExpanded
            : (focusedTaskId == null || ancestorIds.has(rootId) || rootId === focusedTaskId);
          return (
            <TaskTreeNode
              key={rootId}
              item={rootItem}
              children={rootChildren}
              childrenMap={activeChildrenMap}
              allItems={allItems}
              depth={0}
              isFocused={focusedTaskId === rootId}
              isAncestor={ancestorIds.has(rootId)}
              onRemoveDependency={onRemoveDependency}
              defaultExpanded={nodeDefaultExpanded}
              focusedTaskId={focusedTaskId}
            />
          );
        })}
      </div>

      {/* ── Focused-mode: Add dependency picker ── */}
      {canLink && onAddDependency && focusedTaskId != null && (
        <div className="pt-1">
          <AddParentPicker
            candidates={filteredCandidates}
            allCandidates={addCandidates}
            search={search}
            onSearchChange={setSearch}
            open={addOpen}
            onOpenChange={setAddOpen}
            onAdd={(dependsOnTaskId) => {
              onAddDependency(focusedTaskId, dependsOnTaskId);
              setAddOpen(false);
              setSearch("");
            }}
          />
        </div>
      )}
    </div>
  );
}
