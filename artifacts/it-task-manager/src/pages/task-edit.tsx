import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTask,
  useUpdateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  useListWorkflowStages,
  useCreateTaskDependency,
  useDeleteTaskDependency,
  useGetTaskDependencies,
  getGetTaskDependenciesQueryKey,
  getListTasksQueryKey,
  getGetOverdueTasksQueryKey,
  getGetDashboardSummaryQueryKey,
  TaskInputPriority,
  TaskInputCategory,
} from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import { toast } from "@/hooks/use-toast";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Link } from "wouter";
import { TaskFormBasicInfo } from "@/components/forms/task-form-basic-info";
import { TaskFormAssociations } from "@/components/forms/task-form-associations";
import { TaskFormStatusPriority } from "@/components/forms/task-form-status-priority";
import { TaskFormAssigneeDueDate } from "@/components/forms/task-form-assignee-due-date";
import { TaskFormCustomFields } from "@/components/forms/task-form-custom-fields";
import { TaskFormDependencies } from "@/components/forms/task-form-dependencies";
import { validateAssignee } from "@/lib/validate-assignee";

export default function TaskEditPage({ params }: { params: { id: string } }) {
  const taskId = parseInt(params.id, 10);
  const { t: term, ts, tSingular } = useTerminology();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { mutate: updateTask, isPending } = useUpdateTask();
  const { data: projects = [] } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: stages = [] } = useListWorkflowStages();
  const { data: customFields = [] } = useListCustomFieldDefinitions();
  const { isFeatureEnabled, hasPermission } = useOrgContext();
  const { mutate: createDep } = useCreateTaskDependency();
  const { mutate: deleteDep } = useDeleteTaskDependency();
  const canClose = hasPermission("close_tasks");
  const canLinkTasks =
    isFeatureEnabled("task_trees") && hasPermission("link_tasks");

  const {
    data: task,
    isLoading,
    isError,
  } = useGetTask(taskId, {
    query: { enabled: !!taskId, queryKey: ["getTask", taskId] },
  });

  // Form state — initialized from task once loaded
  const [initialized, setInitialized] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<TaskInputPriority>("medium");
  const [category, setCategory] = useState<TaskInputCategory>("other");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, unknown>
  >({});
  // All currently selected parent IDs (existing + added – removed)
  const [selectedParentIds, setSelectedParentIds] = useState<number[]>([]);
  const [depsSeeded, setDepsSeeded] = useState(false);

  // Stable snapshot of the edges that existed when the page first loaded.
  // Using a ref so the save handler always diffs against the ORIGINAL baseline,
  // not against a live query value that may have changed between seed and save.
  const baselineEdgesRef = useRef<Array<{ id: number; taskId: number; dependsOnTaskId: number }>>([]);

  // Unsaved-changes guard
  const [isDirty, setIsDirty] = useState(false);
  const { dialogOpen, handleLeave, handleStay, allowNextNavigation } =
    useUnsavedChangesGuard(isDirty);

  const markDirty = () => setIsDirty(true);

  // Initialize form fields when task loads (programmatic — does not mark dirty)
  useEffect(() => {
    if (task && !initialized) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setProjectId(task.projectId != null ? String(task.projectId) : "none");
      setStatus(task.status);
      setPriority(task.priority as TaskInputPriority);
      setCategory(task.category as TaskInputCategory);
      setAssignee(task.assignee ?? "");
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
      setCustomFieldValues(
        (task.customFields as Record<string, unknown>) ?? {},
      );
      setInitialized(true);
    }
  }, [task, initialized]);

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[],
  );

  const numericProjectId =
    projectId !== "none" ? Number(projectId) : undefined;
  // Show deps tab when task_trees enabled, user can link, AND there's a project
  const showDepsTab = canLinkTasks && !!numericProjectId;

  // Fetch existing dependency edges for this project so we can pre-fill + diff
  const depQueryParams = numericProjectId ? { projectId: numericProjectId } : { projectId: 0 };
  const { data: existingEdges = [], isFetched: depsFetched } = useGetTaskDependencies(depQueryParams, {
    query: {
      enabled: !!numericProjectId && canLinkTasks,
      queryKey: getGetTaskDependenciesQueryKey(depQueryParams),
    },
  });

  // Seed selectedParentIds exactly once, after BOTH the task form and the deps
  // query have fully resolved.  Snapshot the edges into a ref at the same time
  // so the save handler has a stable diff baseline regardless of any later
  // query refetches.
  useEffect(() => {
    if (depsSeeded || !initialized) return;
    // Query is disabled when there's no project or the user can't link tasks —
    // in both cases there are no deps to seed, so treat it as "done".
    const queryDone = !numericProjectId || !canLinkTasks || depsFetched;
    if (!queryDone) return;

    const parentEdges = existingEdges.filter((e) => e.taskId === taskId);
    baselineEdgesRef.current = parentEdges; // snapshot — never overwritten again
    setSelectedParentIds(parentEdges.map((e) => e.dependsOnTaskId));
    setDepsSeeded(true);
  // existingEdges identity changes when the query resolves — that's the trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, depsSeeded, depsFetched, numericProjectId, canLinkTasks, existingEdges, taskId]);

  // Status is read-only when task is in a closed stage and user lacks close_tasks
  const statusReadOnly =
    !canClose && task?.stageType === "closed";

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Task title is required.";
    const assigneeErr = validateAssignee(assignee, memberEmails);
    if (assigneeErr) errs.assignee = assigneeErr;
    return errs;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    updateTask(
      {
        id: taskId,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          projectId: projectId !== "none" ? Number(projectId) : null,
          customFields:
            Object.keys(customFieldValues).length > 0
              ? customFieldValues
              : undefined,
          status,
          priority,
          category,
          assignee: assignee.trim() || null,
          dueDate: dueDate || undefined,
        },
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(["getTask", taskId], data);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetOverdueTasksQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDashboardSummaryQueryKey(),
          });
          // Diff against the stable snapshot captured at seed time —
          // never against a live query value that may have changed.
          const baseline = baselineEdgesRef.current;
          const baselineIds = baseline.map((e) => e.dependsOnTaskId);
          for (const parentId of selectedParentIds) {
            if (!baselineIds.includes(parentId)) {
              createDep({ data: { taskId, dependsOnTaskId: parentId } });
            }
          }
          for (const edge of baseline) {
            if (!selectedParentIds.includes(edge.dependsOnTaskId)) {
              deleteDep({ id: edge.id });
            }
          }
          // Invalidate dep edges so task-detail and any other consumer
          // re-fetches fresh edges after this save
          if (numericProjectId) {
            queryClient.invalidateQueries({
              queryKey: getGetTaskDependenciesQueryKey({ projectId: numericProjectId }),
            });
          }
          toast({
            title: t("taskDetail.editTask", { task: tSingular("tasks") }),
          });
          // Clear guard before navigating away after a successful save
          allowNextNavigation();
          setLocation(`/tasks/${taskId}`);
        },
        onError: () => {
          toast({
            title: t("common.error"),
            description: t("tasks.failedToUpdate"),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !task) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <p className="text-muted-foreground">
          {t("taskDetail.notFound", {
            defaultValue: "Task not found or failed to load.",
          })}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => setLocation("/tasks")}
        >
          {t("common.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      {/* Unsaved-changes confirmation dialog */}
      <UnsavedChangesDialog
        open={dialogOpen}
        onLeave={handleLeave}
        onStay={handleStay}
      />

      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/tasks">{term("tasks")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/tasks/${taskId}`}>{task.title}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {t("taskDetail.editTask", { task: ts("tasks") })}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("taskDetail.editTask", { task: ts("tasks") })}
        </h1>
        <p className="text-muted-foreground mt-1 truncate">{task.title}</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Tabs defaultValue="basic-info" className="space-y-4">
          <div className="overflow-x-auto">
            <TabsList className="flex w-max min-w-full sm:w-auto">
              <TabsTrigger value="basic-info" className="min-w-[100px]">
                {t("tasks.tabBasicInfo", { defaultValue: "Basic Info" })}
              </TabsTrigger>
              <TabsTrigger value="associations" className="min-w-[110px]">
                {t("tasks.tabAssociations", { defaultValue: "Associations" })}
              </TabsTrigger>
              <TabsTrigger value="status-priority" className="min-w-[140px]">
                {t("tasks.tabStatusPriority", {
                  defaultValue: "Status & Priority",
                })}
              </TabsTrigger>
              <TabsTrigger value="assignee-due" className="min-w-[160px]">
                {t("tasks.tabAssigneeDue", {
                  defaultValue: "Assignee & Due Date",
                })}
              </TabsTrigger>
              <TabsTrigger value="custom-fields" className="min-w-[130px]">
                {t("tasks.tabCustomFields", {
                  defaultValue: "Custom Fields",
                })}
              </TabsTrigger>
              {showDepsTab && (
                <TabsTrigger value="dependencies" className="min-w-[120px]">
                  {t("tasks.tabDependencies", {
                    defaultValue: "Dependencies",
                  })}
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <TabsContent value="basic-info" className="mt-0">
              <TaskFormBasicInfo
                title={title}
                onTitleChange={(v) => { setTitle(v); markDirty(); }}
                description={description}
                onDescriptionChange={(v) => { setDescription(v); markDirty(); }}
                titleError={errors.title}
                onTitleErrorChange={(e) =>
                  setErrors((prev) => ({ ...prev, title: e }))
                }
                members={members}
              />
            </TabsContent>

            <TabsContent value="associations" className="mt-0">
              <TaskFormAssociations
                projectId={projectId}
                onProjectIdChange={(v) => { setProjectId(v); markDirty(); }}
                projects={projects}
              />
            </TabsContent>

            <TabsContent value="status-priority" className="mt-0">
              <TaskFormStatusPriority
                status={status}
                onStatusChange={(v) => { setStatus(v); markDirty(); }}
                priority={priority}
                onPriorityChange={(v) => { setPriority(v); markDirty(); }}
                category={category}
                onCategoryChange={(v) => { setCategory(v); markDirty(); }}
                stages={stages}
                readOnly={statusReadOnly}
                statusDisplayName={task.stageName ?? undefined}
                includeClosedStages={canClose}
              />
            </TabsContent>

            <TabsContent value="assignee-due" className="mt-0">
              <TaskFormAssigneeDueDate
                assignee={assignee}
                onAssigneeChange={(v) => { setAssignee(v); markDirty(); }}
                dueDate={dueDate}
                onDueDateChange={(v) => { setDueDate(v); markDirty(); }}
                assigneeError={errors.assignee}
                onAssigneeErrorChange={(e) =>
                  setErrors((prev) => ({ ...prev, assignee: e }))
                }
              />
            </TabsContent>

            <TabsContent value="custom-fields" className="mt-0">
              <TaskFormCustomFields
                fields={customFields}
                values={customFieldValues}
                onChange={(id, value) => {
                  setCustomFieldValues((prev) => ({ ...prev, [id]: value }));
                  markDirty();
                }}
              />
            </TabsContent>

            {showDepsTab && (
              <TabsContent value="dependencies" className="mt-0">
                <TaskFormDependencies
                  projectId={numericProjectId}
                  selectedParentIds={selectedParentIds}
                  onSelectionChange={(v) => { setSelectedParentIds(v); markDirty(); }}
                  excludeTaskId={taskId}
                />
              </TabsContent>
            )}
          </div>
        </Tabs>

        {/* Footer */}
        <div className="flex items-center gap-3 justify-end mt-6 pt-4 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // Cancel is intentional — bypass the guard
              allowNextNavigation();
              setLocation(`/tasks/${taskId}`);
            }}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isPending || (showDepsTab && !depsSeeded)}
          >
            {isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
