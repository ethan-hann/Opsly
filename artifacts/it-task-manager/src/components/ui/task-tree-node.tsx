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

  return (
    <div>
      {/* ── Node row ── */}
      <div
        className={cn(
          "group flex items-center gap-1.5 py-[5px] px-2 rounded-md text-sm",
          "hover:bg-muted/50 transition-colors",
          isFocusedNode && "ring-1 ring-primary/60 bg-primary/5 font-semibold",
          isAncestor && !isFocusedNode && "bg-muted/20",
        )}
      >
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
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-1"
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
