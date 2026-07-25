import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useTerminology } from "@/context/terminology-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProject,
  getListProjectsQueryKey,
  ProjectInputStatus,
  ProjectInputPriority,
  useListOrgMembers,
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
import {
  ProjectFormBasicInfo,
  ProjectFormStatusPriority,
  ProjectFormDueDate,
} from "@/components/forms/project-form-fields";

export default function ProjectNewPage() {
  const { t: term, ts } = useTerminology();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { mutate: createProject, isPending } = useCreateProject();
  const { data: members = [] } = useListOrgMembers();
  const { hasPermission } = useOrgContext();
  const canManageProjects = hasPermission("manage_projects");

  // Redirect away if no permission
  useEffect(() => {
    if (!canManageProjects) {
      setLocation("/projects");
    }
  }, [canManageProjects, setLocation]);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectInputStatus>("planning");
  const [priority, setPriority] = useState<ProjectInputPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Unsaved-changes guard
  const [isDirty, setIsDirty] = useState(false);
  const { dialogOpen, handleLeave, handleStay, allowNextNavigation } =
    useUnsavedChangesGuard(isDirty);

  const markDirty = () => setIsDirty(true);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("projects.nameRequired");
    return errs;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    createProject(
      {
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          dueDate: dueDate || undefined,
        },
      },
      {
        onSuccess: (newProject) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({
            title: t("projects.created"),
            description: t("projects.createdSuccessDesc", {
              name: name.trim(),
            }),
          });
          // Clear guard before navigating away after a successful save
          allowNextNavigation();
          setLocation(`/projects/${newProject.id}`);
        },
        onError: () => {
          toast({
            title: t("common.error"),
            description: t("projects.failedToCreate"),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (!canManageProjects) return null;

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
              <Link href="/projects">{term("projects")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {t("common.new")} {ts("projects")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("common.new")} {ts("projects")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("projects.newProjectDesc", {
            defaultValue: "Fill in the details to create a new {{project}}.",
            project: ts("projects").toLowerCase(),
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
              <TabsTrigger value="status-priority" className="min-w-[140px]">
                {t("tasks.tabStatusPriority", {
                  defaultValue: "Status & Priority",
                })}
              </TabsTrigger>
              <TabsTrigger value="due-date" className="min-w-[100px]">
                {t("common.dueDate")}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <TabsContent value="basic-info" className="mt-0">
              <ProjectFormBasicInfo
                name={name}
                onNameChange={(v) => { setName(v); markDirty(); }}
                description={description}
                onDescriptionChange={(v) => { setDescription(v); markDirty(); }}
                nameError={errors.name}
                onNameErrorChange={(e) =>
                  setErrors((prev) => ({ ...prev, name: e }))
                }
                members={members}
              />
            </TabsContent>

            <TabsContent value="status-priority" className="mt-0">
              <ProjectFormStatusPriority
                status={status}
                onStatusChange={(v) => { setStatus(v); markDirty(); }}
                priority={priority}
                onPriorityChange={(v) => { setPriority(v); markDirty(); }}
              />
            </TabsContent>

            <TabsContent value="due-date" className="mt-0">
              <ProjectFormDueDate
                dueDate={dueDate}
                onDueDateChange={(v) => { setDueDate(v); markDirty(); }}
              />
            </TabsContent>
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
              setLocation("/projects");
            }}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? t("common.saving")
              : t("projects.createProject", { project: ts("projects") })}
          </Button>
        </div>
      </form>
    </div>
  );
}
