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

import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, GitBranch, Link2, ArrowUpToLine, GripVertical } from "lucide-react";
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
  /**
   * Called when the user drags a node onto a new parent.
   * taskId keeps its identity; the edge (taskId → oldParentId) becomes
   * (taskId → newParentId).
   */
  onMoveDependency?: (taskId: number, oldParentId: number, newParentId: number) => void;
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

// ─── "Top Level" drop zone — appears during any drag ─────────────────────────

function TopLevelDropZone({
  dragState,
  onDragStateChange,
  onRemoveDependency,
}: {
  dragState: { taskId: number; parentId: number | null } | null;
  onDragStateChange: (state: { taskId: number; parentId: number | null } | null) => void;
  onRemoveDependency?: (taskId: number, dependsOnTaskId: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  if (dragState == null) return null;

  // Only useful when the dragged node has a parent edge to remove.
  const canAccept = dragState.parentId !== null && !!onRemoveDependency;

  return (
    <div
      role="region"
      aria-label="Drop here to make this a top-level task"
      data-testid="top-level-drop-zone"
      className={cn(
        "flex items-center gap-2 rounded-md border-2 border-dashed px-3 py-2 text-xs transition-colors",
        canAccept
          ? dragOver
            ? "border-primary bg-primary/10 text-primary"
            : "border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground/60"
          : "border-muted-foreground/20 text-muted-foreground/40 cursor-not-allowed",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = canAccept ? "move" : "none";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (canAccept && dragState.parentId !== null) {
          onRemoveDependency!(dragState.taskId, dragState.parentId);
        }
        onDragStateChange(null);
      }}
    >
      <ArrowUpToLine className="w-3.5 h-3.5 shrink-0" />
      <span>
        {canAccept
          ? "Drop here to move to top level"
          : dragState.parentId === null
          ? "Already a top-level task"
          : "Drop here to move to top level"}
      </span>
    </div>
  );
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
  onMoveDependency,
}: TaskTreeVisualizationProps) {
  const { hasPermission } = useOrgContext();
  const { t: term } = useTerminology();
  const canLink = hasPermission("link_tasks");

  // Focused-mode picker state
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Full-mode link form state
  const [showLinkForm, setShowLinkForm] = useState(false);

  // Drag-and-drop state.
  // parentId is null when the dragged node is a root task (no existing edge).
  const [dragState, setDragState] = useState<{ taskId: number; parentId: number | null } | null>(null);

  // Touch drag: floating label position (follows the finger)
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);

  // Refs so that non-React (native DOM) event handlers can read latest values.
  const dragStateRef = useRef(dragState);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);

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
      // Sort all children lists by ID so sibling order is deterministic.
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

      return { childrenMap, parentMap, allItems, rootIds, ancestorIds };
    }, [tasks, edges, focusedTaskId]);

  // Use the full childrenMap in both modes.
  const activeChildrenMap = childrenMap;

  // Invalid drop targets for the current drag: the dragged node itself, its
  // current parent (no-op move), and every task that (transitively) depends on
  // the dragged task — dropping onto those would create a cycle.
  const invalidDropIds = useMemo(() => {
    if (dragState == null) return new Set<number>();
    const invalid = new Set<number>([dragState.taskId]);
    // Exclude current parent only when the dragged node has one (non-root drag).
    if (dragState.parentId !== null) {
      invalid.add(dragState.parentId);
    }
    // BFS down the "depends on dragged" subtree to find all descendants.
    const queue = [...(childrenMap.get(dragState.taskId) ?? [])];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (!invalid.has(curr)) {
        invalid.add(curr);
        queue.push(...(childrenMap.get(curr) ?? []));
      }
    }
    return invalid;
  }, [dragState, childrenMap]);

  // Keep a ref to invalidDropIds so native touch handlers can read it.
  const invalidDropIdsRef = useRef(invalidDropIds);
  useEffect(() => { invalidDropIdsRef.current = invalidDropIds; }, [invalidDropIds]);

  // ── Touch drag-and-drop (native events required for passive:false touchmove) ──
  const containerRef = useRef<HTMLDivElement>(null);

  // Track which element we last highlighted during a touch drag so we can un-highlight it.
  const lastTouchHighlight = useRef<HTMLElement | null>(null);

  function clearTouchHighlight() {
    if (lastTouchHighlight.current) {
      lastTouchHighlight.current.style.outline = "";
      lastTouchHighlight.current.style.borderRadius = "";
      lastTouchHighlight.current.style.backgroundColor = "";
      lastTouchHighlight.current = null;
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleTouchMove(e: TouchEvent) {
      if (dragStateRef.current == null) return;
      // Prevent the page from scrolling while a drag is in progress.
      e.preventDefault();

      const touch = e.touches[0];
      if (!touch) return;

      // Update floating label position via React state (batched; fine for 60fps).
      setTouchPos({ x: touch.clientX, y: touch.clientY });

      // Highlight the node under the finger using direct DOM manipulation to
      // avoid prop-drilling the hover ID through the recursive tree.
      clearTouchHighlight();

      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) return;

      const nodeEl = (el.closest('[data-testid^="tree-node-"]') as HTMLElement | null);
      const zoneEl = (el.closest('[data-testid="top-level-drop-zone"]') as HTMLElement | null);

      if (nodeEl) {
        const testId = nodeEl.getAttribute("data-testid") ?? "";
        const targetId = parseInt(testId.replace("tree-node-", ""), 10);
        const ds = dragStateRef.current;
        const invalid = invalidDropIdsRef.current;
        const isValid = !invalid.has(targetId) && ds != null && targetId !== ds.taskId;
        nodeEl.style.outline = isValid
          ? "2px solid hsl(var(--primary))"
          : "2px solid hsl(var(--destructive))";
        nodeEl.style.borderRadius = "6px";
        nodeEl.style.backgroundColor = isValid
          ? "color-mix(in srgb, hsl(var(--primary)) 10%, transparent)"
          : "color-mix(in srgb, hsl(var(--destructive)) 10%, transparent)";
        lastTouchHighlight.current = nodeEl;
      } else if (zoneEl) {
        const ds = dragStateRef.current;
        if (ds?.parentId !== null) {
          zoneEl.style.outline = "2px solid hsl(var(--primary))";
          zoneEl.style.borderRadius = "6px";
          zoneEl.style.backgroundColor = "color-mix(in srgb, hsl(var(--primary)) 10%, transparent)";
          lastTouchHighlight.current = zoneEl as HTMLElement;
        }
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      const ds = dragStateRef.current;
      clearTouchHighlight();
      setTouchPos(null);

      if (ds == null) return;

      const touch = e.changedTouches[0];
      if (!touch) {
        setDragState(null);
        return;
      }

      const el = document.elementFromPoint(touch.clientX, touch.clientY);

      if (el) {
        // Check top-level drop zone
        const zoneEl = el.closest('[data-testid="top-level-drop-zone"]');
        if (zoneEl && ds.parentId !== null && onRemoveDependency) {
          onRemoveDependency(ds.taskId, ds.parentId);
          setDragState(null);
          return;
        }

        // Check tree node
        const nodeEl = el.closest('[data-testid^="tree-node-"]');
        if (nodeEl) {
          const testId = nodeEl.getAttribute("data-testid") ?? "";
          const targetId = parseInt(testId.replace("tree-node-", ""), 10);
          const invalid = invalidDropIdsRef.current;
          if (!isNaN(targetId) && !invalid.has(targetId)) {
            if (ds.parentId === null) {
              onAddDependency?.(ds.taskId, targetId);
            } else {
              onMoveDependency?.(ds.taskId, ds.parentId, targetId);
            }
          }
        }
      }

      setDragState(null);
    }

    // touchmove must be non-passive so we can call preventDefault.
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    // Cancel drag if touch is interrupted (e.g. incoming call).
    container.addEventListener("touchcancel", () => {
      clearTouchHighlight();
      setTouchPos(null);
      setDragState(null);
    });

    return () => {
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAddDependency, onMoveDependency, onRemoveDependency]);

  // Visible roots in focused mode: only roots that lead to the focused task
  const visibleRootIds = useMemo(() => {
    if (focusedTaskId == null) return rootIds;
    return rootIds.filter(
      (id) => ancestorIds.has(id) || id === focusedTaskId,
    );
  }, [rootIds, focusedTaskId, ancestorIds]);

  // ── Candidate pool for pickers ──
  const pool = candidateTasks ?? tasks;

  // Focused-mode: candidates for "Add dependency"
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

  // Show the top-level drop zone and floating label whenever a drag is active
  // and the user has link_tasks permission.
  const showTopLevelZone = dragState != null && canLink && !!onRemoveDependency;

  // Find the dragged task's display info for the floating label.
  const draggedTask = dragState != null ? tasks.find((t) => t.id === dragState.taskId) : null;

  return (
    <div ref={containerRef} className="space-y-2">
      {/* ── Floating touch-drag label — follows the finger ── */}
      {touchPos != null && draggedTask != null && (
        <div
          aria-hidden
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 rounded-md bg-popover border border-border shadow-lg px-2.5 py-1.5 text-xs font-medium"
          style={{
            left: touchPos.x + 16,
            top: touchPos.y - 16,
            maxWidth: 220,
          }}
        >
          <GripVertical className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-muted-foreground shrink-0">
            TSK-{draggedTask.orgTaskNumber}
          </span>
          <span className="truncate">{draggedTask.title}</span>
        </div>
      )}

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
          {/* Expand / Collapse all */}
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

      {/* ── "Top Level" drop zone — visible during any drag ── */}
      {showTopLevelZone && (
        <TopLevelDropZone
          dragState={dragState}
          onDragStateChange={setDragState}
          onRemoveDependency={onRemoveDependency}
        />
      )}

      {/* ── Tree nodes ── */}
      <div key={treeKey} className="space-y-0.5">
        {renderRoots.map((rootId) => {
          const rootItem = allItems.get(rootId);
          if (!rootItem) return null;
          const rootChildren = (activeChildrenMap.get(rootId) ?? [])
            .map((id) => allItems.get(id)!)
            .filter(Boolean);
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
              onMoveDependency={onMoveDependency}
              onCreateDependency={onAddDependency}
              dragState={dragState}
              onDragStateChange={setDragState}
              invalidDropIds={invalidDropIds}
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
