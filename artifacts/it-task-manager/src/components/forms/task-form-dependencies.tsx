import { useState } from "react";
import { useTerminology } from "@/context/terminology-context";
import {
  useListTasks,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X } from "lucide-react";

interface TaskFormDependenciesProps {
  /** The currently selected project ID (undefined / 0 = no project selected) */
  projectId: number | undefined;
  /** IDs of tasks already selected as parents/dependencies */
  selectedParentIds: number[];
  onSelectionChange: (ids: number[]) => void;
  /** When set, this task ID is excluded from the candidate list (edit mode) */
  excludeTaskId?: number;
}

export function TaskFormDependencies({
  projectId,
  selectedParentIds,
  onSelectionChange,
  excludeTaskId,
}: TaskFormDependenciesProps) {
  const { tSingular } = useTerminology();
  const [depSearch, setDepSearch] = useState("");
  const [depOpen, setDepOpen] = useState(false);

  const depParams = projectId ? { projectId } : undefined;
  const { data: projectTasks = [] } = useListTasks(depParams, {
    query: {
      enabled: !!projectId,
      queryKey: getListTasksQueryKey(depParams),
    },
  });

  if (!projectId) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Depends on (parent {tSingular("tasks").toLowerCase()})
        </p>
        <div className="w-full h-9 px-3 py-2 text-sm text-left border border-input rounded-md bg-muted/30 text-muted-foreground italic flex items-center">
          Select a project above to add dependencies
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        Depends on (parent {tSingular("tasks").toLowerCase()})
      </p>
      <Popover open={depOpen} onOpenChange={setDepOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full min-h-[36px] px-3 py-2 text-sm text-left border border-input rounded-md bg-background hover:bg-muted/40 flex items-center gap-2 flex-wrap"
          >
            {selectedParentIds.length > 0 ? (
              <span className="flex gap-1 flex-wrap">
                {selectedParentIds.map((id) => {
                  const task = projectTasks.find((t) => t.id === id);
                  return (
                    <Badge key={id} variant="secondary" className="text-xs">
                      TSK-{task?.orgTaskNumber ?? id}
                      <button
                        type="button"
                        className="ml-1 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectionChange(
                            selectedParentIds.filter((pid) => pid !== id),
                          );
                        }}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </Badge>
                  );
                })}
              </span>
            ) : (
              <span className="text-muted-foreground italic">
                No dependencies
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-2 border-b">
            <input
              className="w-full text-sm px-2 py-1 bg-transparent outline-none"
              placeholder="Search tasks…"
              value={depSearch}
              onChange={(e) => setDepSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {projectTasks
              .filter(
                (t) =>
                  t.id !== excludeTaskId &&
                  t.stageType !== "closed" &&
                  (depSearch === "" ||
                    t.title.toLowerCase().includes(depSearch.toLowerCase()) ||
                    String(t.orgTaskNumber).includes(depSearch)),
              )
              .map((t) => {
                const selected = selectedParentIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}
                    onClick={() => {
                      onSelectionChange(
                        selected
                          ? selectedParentIds.filter((id) => id !== t.id)
                          : [...selectedParentIds, t.id],
                      );
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      TSK-{t.orgTaskNumber}
                    </span>
                    <span className="truncate">{t.title}</span>
                    {selected && (
                      <span className="ml-auto text-primary text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            {projectTasks.filter(
              (t) => t.id !== excludeTaskId && t.stageType !== "closed",
            ).length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground italic">
                No other open tasks in this project.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
