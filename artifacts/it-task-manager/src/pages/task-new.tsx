import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useListProjects,
  useListOrgMembers,
  useListCustomFieldDefinitions,
  useListWorkflowStages,
  useListTaskTemplates,
  useCreateTaskDependency,
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

export default function TaskNewPage() {
  const { t: term, ts } = useTerminology();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const urlSearch = useSearch();
  const queryClient = useQueryClient();
  const { mutate: createTask, isPending } = useCreateTask();
  const { data: projects = [] } = useListProjects();
  const { data: members = [] } = useListOrgMembers();
  const { data: stages = [] } = useListWorkflowStages();
  const { data: customFields = [] } = useListCustomFieldDefinitions();
  const { isFeatureEnabled, hasPermission } = useOrgContext();
  const { mutate: createDep } = useCreateTaskDependency();

  const activeStages = stages.filter((s) => !s.archivedAt);
  const canLinkTasks =
    isFeatureEnabled("task_trees") && hasPermission("link_tasks");

  const { data: templates = [] } = useListTaskTemplates();

  // Read optional query params
  const params = new URLSearchParams(urlSearch);
  const initialProjectId = params.get("projectId");
  const templateId = params.get("templateId");

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean) as string[],
  );

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(
    initialProjectId ? String(initialProjectId) : "none",
  );
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<TaskInputPriority>("medium");
  const [category, setCategory] = useState<TaskInputCategory>("other");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, unknown>
  >({});
  const [selectedParentIds, setSelectedParentIds] = useState<number[]>([]);

  // Unsaved-changes guard
  const [isDirty, setIsDirty] = useState(false);
  const { dialogOpen, handleLeave, handleStay, allowNextNavigation } =
    useUnsavedChangesGuard(isDirty);

  const markDirty = () => setIsDirty(true);

  // Default status to first active stage (programmatic — does not mark dirty)
  useEffect(() => {
    if (activeStages.length > 0 && !status) {
      setStatus(String(activeStages[0].id));
    }
  }, [activeStages, status]);

  // Apply template from URL param once templates are loaded (marks dirty —
  // the user deliberately chose a template and has work worth preserving)
  const [templateApplied, setTemplateApplied] = useState(false);
  useEffect(() => {
    if (!templateApplied && templateId && templates.length > 0) {
      const tmpl = templates.find((t) => String(t.id) === templateId);
      if (tmpl) {
        if (tmpl.defaultTitle) setTitle(tmpl.defaultTitle);
        if (tmpl.defaultDescription) setDescription(tmpl.defaultDescription);
        setPriority(tmpl.defaultPriority as TaskInputPriority);
        setCategory(tmpl.defaultCategory as TaskInputCategory);
        setIsDirty(true);
      }
      setTemplateApplied(true);
    }
  }, [templateId, templates, templateApplied]);

  const numericProjectId =
    projectId !== "none" ? Number(projectId) : undefined;
  const showDepsTab = canLinkTasks && !!numericProjectId;

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
    createTask(
      {
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          projectId: numericProjectId,
          status,
          priority,
          category,
          assignee: assignee.trim() || undefined,
          dueDate: dueDate || undefined,
          customFields:
            Object.keys(customFieldValues).length > 0
              ? customFieldValues
              : undefined,
        },
      },
      {
        onSuccess: (newTask) => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetOverdueTasksQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDashboardSummaryQueryKey(),
          });
          for (const parentId of selectedParentIds) {
            createDep({
              data: { taskId: newTask.id, dependsOnTaskId: parentId },
            });
          }
          toast({
            title: t("tasks.newTask", { task: ts("tasks") }),
            description: t("tasks.createdSuccess", { title: title.trim() }),
          });
          // Clear guard before navigating away after a successful save
          allowNextNavigation();
          setLocation("/tasks");
        },
        onError: () => {
          toast({
            title: t("common.error"),
            description: t("tasks.failedToCreate"),
            variant: "destructive",
          });
        },
      },
    );
  };

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
            <BreadcrumbPage>
              {t("tasks.newTask", { task: ts("tasks") })}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("tasks.newTask", { task: ts("tasks") })}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("tasks.newTaskDesc", {
            defaultValue: "Fill in the details to create a new {{task}}.",
            task: ts("tasks").toLowerCase(),
          })}
        </p>
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
                disabled={!!initialProjectId}
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
              setLocation("/tasks");
            }}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? t("common.saving")
              : t("tasks.createTask", { task: ts("tasks") })}
          </Button>
        </div>
      </form>
    </div>
  );
}
