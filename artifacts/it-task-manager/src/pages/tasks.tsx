import { useListTasks } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { Plus, Search, LayoutList, Columns } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { NewTaskModal } from "@/components/ui/new-task-modal";
import { KanbanBoard } from "@/components/ui/kanban-board";

type ProjectFilter = "all" | "with_project" | "no_project";

const PROJECT_FILTER_OPTIONS: { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All Tasks" },
  { value: "with_project", label: "In a Project" },
  { value: "no_project", label: "No Project" },
];

export default function TasksList() {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [showNewTask, setShowNewTask] = useState(false);

  const { data: tasks, isLoading } = useListTasks();

  const filteredTasks = tasks?.filter(t => {
    // Text search
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.projectName && t.projectName.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch) return false;

    // Project filter
    if (projectFilter === "with_project") return !!t.projectId;
    if (projectFilter === "no_project") return !t.projectId;
    return true;
  });

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
      <div className="flex flex-col sm:flex-row gap-3 bg-card p-2 rounded-lg border border-border shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks, tickets, projects..."
            className="pl-9 bg-background/50 border-transparent focus-visible:border-primary"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Project filter segment */}
          <div className="bg-background/50 flex p-1 rounded-md border border-border">
            {PROJECT_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setProjectFilter(opt.value)}
                className={`px-3 h-8 text-xs rounded-sm font-medium transition-colors ${
                  projectFilter === opt.value
                    ? "bg-secondary text-secondary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* View toggle */}
          <div className="bg-background/50 flex p-1 rounded-md border border-border">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon"
              className="w-8 h-8 rounded-sm"
              onClick={() => setViewMode('list')}
            >
              <LayoutList className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'board' ? 'secondary' : 'ghost'}
              size="icon"
              className="w-8 h-8 rounded-sm"
              onClick={() => setViewMode('board')}
            >
              <Columns className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : viewMode === 'list' ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {filteredTasks && filteredTasks.length > 0 ? (
                filteredTasks.map(task => (
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
