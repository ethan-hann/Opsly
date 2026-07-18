import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateTask, getListTasksQueryKey } from "@workspace/api-client-react";
import type { Task, TaskStatus } from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const COLUMNS: { id: TaskStatus; label: string; borderClass: string }[] = [
  { id: "todo", label: "To Do", borderClass: "border-t-stone-400" },
  { id: "in_progress", label: "In Progress", borderClass: "border-t-amber-500" },
  { id: "blocked", label: "Blocked", borderClass: "border-t-red-500" },
  { id: "done", label: "Done", borderClass: "border-t-emerald-500" },
];

// Prefix used to distinguish column IDs from task IDs in drag events
const COL_PREFIX = "col::";

interface TaskCardProps {
  task: Task;
  overlay?: boolean;
}

function TaskCard({ task, overlay }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "task", task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-card border border-border rounded-lg p-3 space-y-2 cursor-grab active:cursor-grabbing select-none",
        isDragging && !overlay && "opacity-40 ring-2 ring-primary/30",
        overlay && "rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/tasks/${task.id}`} onClick={(e) => e.stopPropagation()}>
          <span className="text-sm font-medium leading-tight hover:text-primary transition-colors line-clamp-2 cursor-pointer">
            {task.title}
          </span>
        </Link>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground font-mono">
        <span className="px-1 py-0.5 rounded border border-border uppercase">{task.category}</span>
        {task.projectName && (
          <span className="text-foreground/70 truncate max-w-[120px]">{task.projectName}</span>
        )}
        {task.dueDate && <span>Due {formatDate(task.dueDate)}</span>}
      </div>
      {task.assignee && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] text-primary font-semibold">
            {task.assignee.charAt(0).toUpperCase()}
          </div>
          <span className="truncate">{task.assignee}</span>
        </div>
      )}
      <div className="text-[10px] font-mono text-muted-foreground/60">TSK-{task.id}</div>
    </div>
  );
}

interface KanbanColumnProps {
  columnId: TaskStatus;
  label: string;
  borderClass: string;
  tasks: Task[];
  isOver: boolean;
}

function KanbanColumn({ columnId, label, borderClass, tasks, isOver }: KanbanColumnProps) {
  // useDroppable makes this a valid drop target — even when empty
  const { setNodeRef } = useDroppable({ id: `${COL_PREFIX}${columnId}` });

  return (
    <div className="flex flex-col min-w-[260px] w-full">
      <div
        className={cn(
          "bg-card border border-border rounded-t-lg border-t-2 p-3 flex items-center justify-between",
          borderClass
        )}
      >
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs font-mono bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 bg-muted/20 border border-t-0 border-border rounded-b-lg p-2 space-y-2 min-h-[200px] transition-colors",
          isOver && "bg-primary/5 border-primary/30"
        )}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-full py-8 text-xs text-muted-foreground/50 font-mono">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  tasks: Task[];
}

export function KanbanBoard({ tasks }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const { mutate: updateTask } = useUpdateTask();

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Optimistic status overrides while dragging: taskId -> TaskStatus
  const [optimisticStatus, setOptimisticStatus] = useState<
    Record<number, TaskStatus>
  >({});
  // Which column droppable is currently hovered
  const [overColumnId, setOverColumnId] = useState<TaskStatus | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  /** Effective status for a task, considering optimistic overrides */
  const effectiveStatus = useCallback(
    (taskId: number): TaskStatus =>
      (optimisticStatus[taskId] as TaskStatus) ??
      tasks.find((t) => t.id === taskId)?.status ??
      "todo",
    [tasks, optimisticStatus]
  );

  const getTasksForColumn = useCallback(
    (colId: TaskStatus) =>
      tasks.filter((t) => effectiveStatus(t.id) === colId),
    [tasks, effectiveStatus]
  );

  /** Given an `over.id`, return the target TaskStatus column or null */
  const resolveTargetColumn = (overId: string | number): TaskStatus | null => {
    const overStr = String(overId);
    // Direct column drop zone
    if (overStr.startsWith(COL_PREFIX)) {
      return overStr.slice(COL_PREFIX.length) as TaskStatus;
    }
    // Another task card — find its effective column
    const overTaskId = Number(overId);
    if (!Number.isNaN(overTaskId)) {
      return effectiveStatus(overTaskId);
    }
    return null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const task = tasks.find((t) => t.id === active.id);
    if (task) setActiveTask(task);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) {
      setOverColumnId(null);
      return;
    }

    const activeId = active.id as number;
    const targetCol = resolveTargetColumn(over.id);

    if (!targetCol) {
      setOverColumnId(null);
      return;
    }

    // Track which column header is highlighted
    setOverColumnId(targetCol);

    const currentCol = effectiveStatus(activeId);
    if (currentCol !== targetCol) {
      setOptimisticStatus((prev) => ({ ...prev, [activeId]: targetCol }));
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    setOverColumnId(null);

    const activeId = active.id as number;
    const newStatus = optimisticStatus[activeId] as TaskStatus | undefined;

    // Clear the optimistic override
    setOptimisticStatus((prev) => {
      const next = { ...prev };
      delete next[activeId];
      return next;
    });

    if (!over || !newStatus) return;

    const originalTask = tasks.find((t) => t.id === activeId);
    if (!originalTask || originalTask.status === newStatus) return;

    // Persist to API
    updateTask(
      { id: activeId, data: { status: newStatus } },
      {
        onSuccess: (updated) => {
          // Patch the individual task cache used by task-detail
          queryClient.setQueryData(["getTask", activeId], updated);
          // Invalidate all list-task queries (covers both the default Orval key
          // and custom keys like ["listTasks", { projectId }] in project-detail)
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["listTasks"] });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update task status.",
            variant: "destructive",
          });
          // Revert all caches to server state
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["listTasks"] });
          queryClient.invalidateQueries({ queryKey: ["getTask", activeId] });
        },
      }
    );
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    setOverColumnId(null);
    setOptimisticStatus({});
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            columnId={col.id}
            label={col.label}
            borderClass={col.borderClass}
            tasks={getTasksForColumn(col.id)}
            isOver={overColumnId === col.id}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
