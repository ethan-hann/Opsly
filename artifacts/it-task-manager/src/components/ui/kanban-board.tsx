import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
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
import {
  useUpdateTask,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
} from "@workspace/api-client-react";
import type { Task, WorkflowStage } from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Archive } from "lucide-react";

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
        overlay && "rotate-2 shadow-xl",
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="px-1 py-0.5 rounded border border-border uppercase">{task.category}</span>
        {task.projectName && (
          <span className="text-foreground/70 truncate max-w-[120px]">{task.projectName}</span>
        )}
        {task.dueDate && <span>Due {formatDate(task.dueDate)}</span>}
      </div>
      {task.stageArchived && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Archive className="w-3 h-3" />
          Archived stage
        </div>
      )}
      {task.assignee && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] text-primary font-semibold">
            {task.assignee.charAt(0).toUpperCase()}
          </div>
          <span className="truncate">{task.assignee}</span>
        </div>
      )}
      <div className="text-[10px] font-mono text-muted-foreground/60">TSK-{task.orgTaskNumber}</div>
    </div>
  );
}

interface KanbanColumnProps {
  stageId: number;
  label: string;
  color: string;
  tasks: Task[];
  isOver: boolean;
  archived?: boolean;
}

function KanbanColumn({ stageId, label, color, tasks, isOver, archived }: KanbanColumnProps) {
  const { t: term } = useTerminology();
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({ id: `${COL_PREFIX}${stageId}` });

  const r = parseInt(color.replace("#", "").slice(0, 2), 16);
  const g = parseInt(color.replace("#", "").slice(2, 4), 16);
  const b = parseInt(color.replace("#", "").slice(4, 6), 16);

  return (
    <div className="flex flex-col min-w-[260px] w-full">
      <div
        className={cn(
          "rounded-t-lg border-t-4 border-l border-r border-b-0 px-3 py-2.5",
          isOver ? "bg-muted/80" : "bg-muted/40",
        )}
        style={{ borderTopColor: color }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground" style={{ color: archived ? undefined : color }}>
            {label}
          </span>
          {archived && (
            <Archive className="w-3 h-3 text-muted-foreground" />
          )}
          <span
            className="ml-auto text-xs font-medium rounded-full px-1.5 py-0.5 min-w-[20px] text-center"
            style={{
              backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`,
              color,
            }}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-b-lg border border-t-0 border-border p-2 space-y-2 min-h-[120px] transition-colors",
          isOver && "bg-muted/30 border-primary/30",
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
          <p className="text-xs text-center text-muted-foreground/50 py-6">
            {t("tasks.noTasks", { tasks: term("tasks").toLowerCase() })}
          </p>
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  tasks: Task[];
  /** Active (non-archived) workflow stages to build columns from */
  stages: WorkflowStage[];
}

export function KanbanBoard({ tasks, stages }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overColumnId, setOverColumnId] = useState<number | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<Record<number, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const updateTask = useUpdateTask();

  // Active (non-archived) stages → columns, plus any archived stage that has tasks
  const archivedStagesWithTasks = (() => {
    const archivedIds = new Set(
      stages.filter(() => false).map((s) => s.id), // placeholder — handled below
    );
    void archivedIds;
    return [] as WorkflowStage[];
  })();
  void archivedStagesWithTasks;

  const activeStages = stages.filter((s) => !s.archivedAt);

  // Gather archived stages referenced by tasks (to show their column)
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const archivedStageIdsInUse = new Set<number>();
  for (const task of tasks) {
    const sid = parseInt(task.status, 10);
    if (!isNaN(sid)) {
      const stage = stageMap.get(sid);
      if (stage?.archivedAt) archivedStageIdsInUse.add(stage.id);
    }
  }
  const archivedColumnsInUse = Array.from(archivedStageIdsInUse).map((id) => stageMap.get(id)!).filter(Boolean);

  const allColumns = [...activeStages, ...archivedColumnsInUse];

  const getTasksForColumn = useCallback(
    (stageId: number) => {
      return tasks.filter((t) => {
        const effectiveStatus = optimisticStatus[t.id] ?? t.status;
        const sid = parseInt(effectiveStatus, 10);
        return sid === stageId;
      });
    },
    [tasks, optimisticStatus],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
      setActiveId(task.id);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverColumnId(null);
      return;
    }
    const overId = String(over.id);
    if (overId.startsWith(COL_PREFIX)) {
      setOverColumnId(parseInt(overId.slice(COL_PREFIX.length), 10));
    } else {
      // Hovering over a task card — find which column it belongs to
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) {
        setOverColumnId(parseInt(overTask.status, 10));
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setActiveId(null);
    setOverColumnId(null);

    if (!over) return;

    const task = active.data.current?.task as Task | undefined;
    if (!task) return;

    let targetStageId: number | null = null;
    const overId = String(over.id);
    if (overId.startsWith(COL_PREFIX)) {
      targetStageId = parseInt(overId.slice(COL_PREFIX.length), 10);
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) targetStageId = parseInt(overTask.status, 10);
    }

    if (!targetStageId || isNaN(targetStageId)) return;
    const currentStatus = optimisticStatus[task.id] ?? task.status;
    if (String(targetStageId) === currentStatus) return;

    // Optimistic update
    const newStatus = String(targetStageId);
    setOptimisticStatus((prev) => ({ ...prev, [task.id]: newStatus }));

    updateTask.mutate(
      { id: task.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          setOptimisticStatus((prev) => {
            const next = { ...prev };
            delete next[task.id];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to update task status.",
            variant: "destructive",
          });
          setOptimisticStatus((prev) => {
            const next = { ...prev };
            delete next[task.id];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["getTask", activeId] });
        },
      },
    );
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    setActiveId(null);
    setOverColumnId(null);
    setOptimisticStatus({});
  };

  if (allColumns.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No workflow stages configured. Add stages in Org Settings → Workflow.
      </div>
    );
  }

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
        {allColumns.map((col) => (
          <KanbanColumn
            key={col.id}
            stageId={col.id}
            label={col.name}
            color={col.color}
            tasks={getTasksForColumn(col.id)}
            isOver={overColumnId === col.id}
            archived={!!col.archivedAt}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
