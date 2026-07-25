/**
 * TaskTreeNode — recursive tree node for the task dependency tree view.
 *
 * Renders a VS Code-style folder tree with connecting guide lines, open/closed
 * badges, expand/collapse, navigation links, and inline dependency controls.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  X,
  Check,
  GripVertical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useOrgContext } from "@/hooks/use-org-context";

export interface TaskTreeItemData {
  id: number;
  orgTaskNumber: number;
  title: string;
  stageName: string;
  isClosed: boolean;
}

interface TaskTreeNodeProps {
  item: TaskTreeItemData;
  children: TaskTreeItemData[];
  /** Map from task ID → its children's IDs */
  childrenMap: Map<number, number[]>;
  /** All items in scope, keyed by ID */
  allItems: Map<number, TaskTreeItemData>;
  /** Depth in the tree (0 = root) */
  depth: number;
  /** Whether this node is the focused task (passed from parent for root-level nodes) */
  isFocused?: boolean;
  /** Whether this node is an ancestor of the focused task */
  isAncestor?: boolean;
  /** Callback to remove a dependency edge (× button) */
  onRemoveDependency?: (edgeTaskId: number, edgeDependsOnTaskId: number) => void;
  /** The parent task ID (for dependency removal). undefined = root node. */
  parentTaskId?: number;
  /** Whether this node should start expanded */
  defaultExpanded?: boolean;
  /**
   * When set, any node at ANY depth whose ID equals this value gets the focused
   * highlight. Propagated down through every recursive child so the focused task
   * is highlighted wherever it appears in the tree (multi-parent / DAG trees).
   */
  focusedTaskId?: number;
  /**
   * Drag-and-drop re-parenting. Called when a node that already has a parent
   * edge is dropped onto a new parent (moves the existing edge).
   */
  onMoveDependency?: (taskId: number, oldParentId: number, newParentId: number) => void;
  /**
   * Drag-and-drop edge creation. Called when a root node (no parent) is
   * dropped onto another node, creating a new dependency edge.
   */
  onCreateDependency?: (taskId: number, newParentId: number) => void;
  /**
   * Currently dragged node, or null when no drag is in progress.
   * parentId is null when the dragged node is a root (has no existing edge).
   */
  dragState?: { taskId: number; parentId: number | null } | null;
  /** Set/clear the drag state (owned by the visualization). */
  onDragStateChange?: (state: { taskId: number; parentId: number | null } | null) => void;
  /** Task IDs that are invalid drop targets for the current drag (would cycle, self, etc.). */
  invalidDropIds?: Set<number>;
}

export function TaskTreeNode({
  item,
  children,
  childrenMap,
  allItems,
  depth,
  isFocused,
  isAncestor,
  onRemoveDependency,
  parentTaskId,
  defaultExpanded = true,
  focusedTaskId,
  onMoveDependency,
  onCreateDependency,
  dragState,
  onDragStateChange,
  invalidDropIds,
}: TaskTreeNodeProps) {
  const { hasPermission } = useOrgContext();
  const canLink = hasPermission("link_tasks");

  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Inline two-step confirm for dependency removal
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // A node is "focused" if explicitly flagged by the parent OR if its ID matches
  // the focusedTaskId passed from the visualization (handles multi-parent DAG trees
  // where the focused task can appear at multiple positions in the same tree).
  const isFocusedNode = isFocused || (focusedTaskId !== undefined && item.id === focusedTaskId);

  // ── Drag-and-drop re-parenting / edge creation ──
  const dndEnabled = canLink && !!(onMoveDependency || onCreateDependency) && !!onDragStateChange;
  // Any node can be dragged when DnD is enabled (root nodes create new edges;
  // nodes with a parent move their existing edge).
  const canDrag = dndEnabled;
  // This specific tree instance of the node is "dragging" when the drag state
  // matches both the task ID and the parent context (null for root nodes).
  const thisParentId = parentTaskId ?? null;
  const isDragging =
    dragState != null &&
    dragState.taskId === item.id &&
    dragState.parentId === thisParentId;

  // While a drag is active, is THIS node a valid drop target?
  const dragActive = dndEnabled && dragState != null;
  const isInvalidTarget = dragActive && (invalidDropIds?.has(item.id) ?? false);
  const isValidTarget = dragActive && !isInvalidTarget && !isDragging;
  const [dragOver, setDragOver] = useState(false);

  return (
    <div data-testid={`tree-wrapper-${item.id}`}>
      {/* ── Node row ── */}
      <div
        className={cn(
          "group flex items-center gap-1.5 py-[5px] px-2 rounded-md text-sm",
          "hover:bg-muted/50 transition-colors",
          isFocusedNode && "ring-1 ring-primary/60 bg-primary/5 font-semibold",
          isAncestor && !isFocusedNode && "bg-muted/20",
          isDragging && "opacity-40",
          dragOver && isValidTarget && "ring-2 ring-primary bg-primary/10",
          dragOver && isInvalidTarget && "ring-2 ring-destructive bg-destructive/10 cursor-not-allowed",
        )}
        data-testid={`tree-node-${item.id}`}
        onDragOver={
          dragActive
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = isValidTarget ? "move" : "none";
                setDragOver(true);
              }
            : undefined
        }
        onDragLeave={dragActive ? () => setDragOver(false) : undefined}
        onDrop={
          dragActive
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                const dragged = dragState!;
                onDragStateChange!(null);
                if (isValidTarget) {
                  if (dragged.parentId === null) {
                    // Root node dropped onto a new parent → create a new edge
                    onCreateDependency?.(dragged.taskId, item.id);
                  } else {
                    // Non-root node dropped onto a new parent → move existing edge
                    onMoveDependency?.(dragged.taskId, dragged.parentId, item.id);
                  }
                }
              }
            : undefined
        }
      >
        {/* Drag handle — always visible on touch devices, hover-revealed on pointer devices */}
        {canDrag && (
          <span
            draggable
            role="button"
            aria-label={`Drag to move TSK-${item.orgTaskNumber} to a new parent`}
            title={parentTaskId !== undefined ? "Drag to a new parent" : "Drag to add a parent"}
            data-testid={`drag-handle-${item.id}`}
            className={cn(
              "shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground",
              // On pointer devices: hidden until hover. On touch devices: always visible.
              "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity -ml-1",
              // Larger touch target on coarse-pointer (touch) devices
              "[@media(pointer:coarse)]:p-2 [@media(pointer:coarse)]:-m-2",
              isDragging && "opacity-100",
            )}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(item.id));
              // Defer the React state update by one tick.  Calling setState
              // synchronously inside dragstart triggers a re-render that
              // mutates the DOM under the dragged element, causing browsers
              // (especially inside iframes) to immediately cancel the drag.
              const taskId = item.id;
              const parentId = thisParentId;
              setTimeout(() => {
                onDragStateChange!({ taskId, parentId });
              }, 0);
            }}
            onDragEnd={() => {
              // Defer clearing drag state by one tick.  In some browsers
              // (notably Firefox) dragEnd can fire before the drop event, which
              // would unmount the TopLevelDropZone before it receives the drop.
              // setTimeout(0) queues the clear after any pending drop event has
              // already had a chance to execute (and to call onDragStateChange
              // itself), so the zone stays visible until the gesture is fully
              // resolved.
              setTimeout(() => onDragStateChange!(null), 0);
            }}
            onTouchStart={() => {
              // Activate touch-drag state; scroll prevention is handled by
              // the container's non-passive touchmove listener.
              onDragStateChange!({ taskId: item.id, parentId: thisParentId });
            }}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
        )}
        {/* Expand / collapse chevron */}
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Folder / file icon */}
        <span
          className={cn(
            "shrink-0",
            isFocusedNode ? "text-primary" : "text-muted-foreground",
          )}
        >
          {hasChildren ? (
            expanded ? (
              <FolderOpen className="w-3.5 h-3.5" />
            ) : (
              <Folder className="w-3.5 h-3.5" />
            )
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
        </span>

        {/* Task number + title (navigable) */}
        <Link
          href={`/tasks/${item.id}`}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-1.5 hover:text-primary transition-colors",
            isFocusedNode && "text-primary",
          )}
        >
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">
            TSK-{item.orgTaskNumber}
          </span>
          <span className="truncate">{item.title}</span>
        </Link>

        {/* Open / Closed badge */}
        <Badge
          variant={item.isClosed ? "secondary" : "outline"}
          className={cn(
            "text-[10px] py-0 px-1.5 shrink-0 font-normal",
            !item.isClosed && "border-primary/40 text-primary/80",
          )}
        >
          {item.isClosed ? "Closed" : "Open"}
        </Badge>

        {/* Stage name */}
        <span className="text-[11px] text-muted-foreground shrink-0 max-w-[72px] truncate hidden sm:block">
          {item.stageName}
        </span>

        {/* Remove dependency — × turns into an inline confirm before deleting */}
        {canLink && parentTaskId !== undefined && onRemoveDependency && (
          confirmingRemove ? (
            <span className="shrink-0 flex items-center gap-1 ml-1 text-[11px]">
              <span className="text-muted-foreground hidden sm:inline">Remove link?</span>
              <button
                type="button"
                className="p-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                onClick={() => {
                  onRemoveDependency(item.id, parentTaskId);
                  setConfirmingRemove(false);
                }}
                title="Confirm remove"
                aria-label="Confirm remove dependency"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setConfirmingRemove(false)}
                title="Cancel"
                aria-label="Cancel remove dependency"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="shrink-0 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity text-muted-foreground hover:text-destructive ml-1"
              onClick={() => setConfirmingRemove(true)}
              title="Remove dependency"
              aria-label="Remove dependency"
            >
              <X className="w-3 h-3" />
            </button>
          )
        )}
      </div>

      {/* ── Children with tree guide lines ── */}
      {hasChildren && expanded && (
        <div className="relative ml-[18px] border-l-2 border-muted-foreground/40 mt-0.5">
          {children.map((child) => {
            const grandChildren = (childrenMap.get(child.id) ?? [])
              .map((id) => allItems.get(id)!)
              .filter(Boolean);
            return (
              <div key={child.id} className="relative">
                {/* Horizontal elbow connector */}
                <div className="absolute left-0 top-[14px] w-3.5 h-[2px] bg-muted-foreground/40" />
                <div className="pl-4">
                  <TaskTreeNode
                    item={child}
                    children={grandChildren}
                    childrenMap={childrenMap}
                    allItems={allItems}
                    depth={depth + 1}
                    isFocused={false}
                    isAncestor={false}
                    onRemoveDependency={onRemoveDependency}
                    parentTaskId={item.id}
                    defaultExpanded={defaultExpanded}
                    focusedTaskId={focusedTaskId}
                    onMoveDependency={onMoveDependency}
                    onCreateDependency={onCreateDependency}
                    dragState={dragState}
                    onDragStateChange={onDragStateChange}
                    invalidDropIds={invalidDropIds}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
