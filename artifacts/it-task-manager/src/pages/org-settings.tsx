import { useState, useRef } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListOrgMembers,
  useListOrgInvitations,
  useInviteOrgMember,
  useCancelOrgInvitation,
  useRemoveOrgMember,
  useUpdateOrgMemberRole,
  useLeaveOrg,
  useRenameOrg,
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useGetSLAPolicies,
  useUpsertSLAPolicies,
  useListTaskTemplates,
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
  useDeleteTaskTemplate,
  useListWorkflowStages,
  useCreateWorkflowStage,
  useUpdateWorkflowStage,
  useRemoveWorkflowStage,
  useReorderWorkflowStages,
  getListWorkflowStagesQueryKey,
} from "@workspace/api-client-react";
import type { OrgMemberInfo, Role, RolePermissions, SlaPolicy, TaskTemplate, WorkflowStage } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  AlertTriangle, Building2, Clock, Copy, Crown, FileText, GripVertical, Link2, LogOut,
  Mail, Pencil, Plus, Settings2, Shield, Sliders, Timer, Trash2, UserPlus, X,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { CustomFieldsManager } from "@/components/ui/custom-fields-manager";
import { MarkdownEditor } from "@/components/notes/markdown-editor";

// ─── Permission metadata ──────────────────────────────────────────────────────

type PermKey = keyof RolePermissions;

interface PermGroup {
  label: string;
  keys: PermKey[];
}

const PERM_GROUPS: PermGroup[] = [
  {
    label: "Tasks",
    keys: ["view_tasks", "create_tasks", "edit_tasks", "close_tasks", "delete_tasks"],
  },
  {
    label: "Projects & org",
    keys: ["manage_projects", "manage_org_settings", "manage_members"],
  },
  {
    label: "Features",
    keys: [
      "manage_webhooks", "manage_api_keys", "manage_custom_fields",
      "manage_workflow_stages", "manage_sla_policies", "manage_task_templates",
      "manage_saved_views", "view_audit_log",
    ],
  },
];

const PERM_LABELS: Record<PermKey, string> = {
  view_tasks: "View tasks",
  create_tasks: "Create tasks",
  edit_tasks: "Edit tasks",
  close_tasks: "Close / reopen tasks",
  delete_tasks: "Delete tasks",
  manage_projects: "Manage projects",
  manage_org_settings: "Org settings",
  manage_members: "Manage members",
  manage_webhooks: "Webhooks",
  manage_api_keys: "API keys",
  manage_custom_fields: "Custom fields",
  manage_workflow_stages: "Workflow stages",
  manage_sla_policies: "SLA policies",
  manage_task_templates: "Task templates",
  manage_saved_views: "Saved views",
  view_audit_log: "Audit log",
};

// All permission keys in PERM_GROUPS order — used to build blank permission sets.
const ALL_PERM_KEYS: PermKey[] = PERM_GROUPS.flatMap((g) => g.keys);

// Starting state for a fresh custom role: every permission off.
// The API merges over MEMBER_PERMISSIONS when permissions are omitted, but since
// we always send an explicit object, the sent value is used as-is.
const BLANK_PERMISSIONS: RolePermissions = Object.fromEntries(
  ALL_PERM_KEYS.map((k) => [k, false]),
) as unknown as RolePermissions;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInviteLink(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}invite/${token}`;
}

function roleBadgeVariant(roleName: string): "default" | "secondary" | "outline" {
  if (roleName === "Owner") return "default";
  if (roleName === "Admin") return "secondary";
  return "outline";
}

// ─── LeaveOrgSection ─────────────────────────────────────────────────────────

interface LeaveOrgSectionProps {
  orgName: string;
  isOwner: boolean;
  isOnlyMember: boolean;
  isLeaving: boolean;
  onLeave: () => void;
}

function LeaveOrgSection({ orgName, isOwner, isOnlyMember, isLeaving, onLeave }: LeaveOrgSectionProps) {
  if (isOnlyMember) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-destructive">This will permanently delete the organization</p>
            <p className="text-muted-foreground mt-0.5">
              You are the only member. Leaving will delete <strong>{orgName}</strong> and all its
              projects, tasks, and data.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isLeaving} className="gap-2">
              <LogOut className="w-4 h-4" />
              {isLeaving ? "Leaving…" : "Delete organization & leave"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete organization?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{orgName}</strong> and all its projects, tasks,
                and data. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onLeave}
              >
                Delete &amp; leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (isOwner) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <Shield className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">Transfer the Owner role first</p>
            <p className="text-muted-foreground mt-0.5">
              Assign the Owner role to another member via the Members section, then you can leave.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled className="gap-2">
          <LogOut className="w-4 h-4" />
          Leave organization
        </Button>
      </div>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isLeaving} className="gap-2">
          <LogOut className="w-4 h-4" />
          {isLeaving ? "Leaving…" : "Leave organization"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {orgName}?</AlertDialogTitle>
          <AlertDialogDescription>
            You will lose access to all projects and tasks in this organization. Your work will remain
            and can be reassigned.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onLeave}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── RoleCard ─────────────────────────────────────────────────────────────────

interface RoleCardProps {
  role: Role;
  canEdit: boolean; // owner only
  members: OrgMemberInfo[]; // full org member list, used to warn before deletion
  onUpdated: () => void;
  onDeleted: () => void;
  onDuplicate: (role: Role) => void;
}

function memberDisplayName(m: OrgMemberInfo): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return name || m.email || m.userId;
}

function RoleCard({ role, canEdit, members, onUpdated, onDeleted, onDuplicate }: RoleCardProps) {
  const { toast } = useToast();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(role.name);

  const { mutate: updateRole, isPending: isUpdating } = useUpdateRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated" });
        setIsEditingName(false);
        onUpdated();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: deleteRole, isPending: isDeleting } = useDeleteRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role deleted", description: "Members were reassigned to Member role." });
        onDeleted();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to delete role", description: err.message, variant: "destructive" });
      },
    },
  });

  function handlePermToggle(key: PermKey, value: boolean) {
    updateRole({
      id: role.id,
      data: { permissions: { ...role.permissions, [key]: value } },
    });
  }

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === role.name) { setIsEditingName(false); return; }
    updateRole({ id: role.id, data: { name: trimmed } });
  }

  // All built-in roles (Owner, Admin, Member) are read-only at both the API
  // and UI layers. Only custom roles may have their permissions edited.
  const isImmutable = role.isBuiltIn;

  // Members currently assigned to this role — shown in the delete dialog so
  // the owner knows exactly who will be downgraded to the Member built-in role.
  const affectedMembers = members.filter((m) => m.roleId === role.id);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Built-in role notice */}
      {role.isBuiltIn && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Built-in roles cannot be edited. To customize permissions, create a new custom role for your organization.
          </span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {canEdit && isEditingName ? (
            <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setNameValue(role.name); setIsEditingName(false); } }}
                autoFocus
                maxLength={100}
                className="h-7 text-sm font-semibold"
                disabled={isUpdating}
              />
              <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={isUpdating || !nameValue.trim()}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => { setNameValue(role.name); setIsEditingName(false); }}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{role.name}</span>
              {role.isBuiltIn && (
                <Badge variant="outline" className="text-xs py-0">Built-in</Badge>
              )}
              {role.isOwner && (
                <Badge className="text-xs py-0 gap-1">
                  <Crown className="w-3 h-3" />
                  Owner
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-xs py-0 ${affectedMembers.length === 0 ? "text-muted-foreground/50 border-border/50" : "text-muted-foreground"}`}
              >
                {affectedMembers.length} {affectedMembers.length === 1 ? "member" : "members"}
              </Badge>
              {canEdit && !role.isBuiltIn && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setNameValue(role.name); setIsEditingName(true); }}
                  title="Rename role"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
        {/* Duplicate */}
        {canEdit && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            onClick={() => onDuplicate(role)}
            title={`Duplicate "${role.name}" role`}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Delete */}
        {canEdit && !role.isBuiltIn && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title="Delete role"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{role.name}" role?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    {affectedMembers.length === 0 ? (
                      <p>
                        No members are currently assigned to this role. Deleting it is safe
                        and cannot be undone.
                      </p>
                    ) : (
                      <>
                        <p>
                          <strong>{affectedMembers.length} {affectedMembers.length === 1 ? "member" : "members"}</strong>{" "}
                          will be moved to the built-in <strong>Member</strong> role, which may
                          reduce their permissions. This cannot be undone.
                        </p>
                        <ul className="text-xs rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1 max-h-36 overflow-y-auto">
                          {affectedMembers.slice(0, 8).map((m) => (
                            <li key={m.userId} className="truncate text-foreground">
                              {memberDisplayName(m)}
                            </li>
                          ))}
                          {affectedMembers.length > 8 && (
                            <li className="text-muted-foreground">
                              …and {affectedMembers.length - 8} more
                            </li>
                          )}
                        </ul>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteRole({ id: role.id })}
                >
                  Delete role
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Permission groups */}
      <div className="space-y-3">
        {PERM_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{group.label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {group.keys.map((key) => {
                const enabled = role.permissions[key];
                const editable = canEdit && !isImmutable;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      id={`${role.id}-${key}`}
                      checked={enabled}
                      onCheckedChange={(v) => handlePermToggle(key, v)}
                      disabled={!editable || isUpdating}
                      className="h-4 w-7 data-[state=checked]:bg-primary"
                    />
                    <Label
                      htmlFor={`${role.id}-${key}`}
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {PERM_LABELS[key]}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TaskTemplatesCard ────────────────────────────────────────────────────────

const TEMPLATE_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

const TEMPLATE_CATEGORY_OPTIONS = [
  { value: "incident", label: "Incident" },
  { value: "change", label: "Change" },
  { value: "maintenance", label: "Maintenance" },
  { value: "deployment", label: "Deployment" },
  { value: "support", label: "Support" },
  { value: "other", label: "Other" },
] as const;

interface TemplateFormState {
  name: string;
  defaultTitle: string;
  defaultPriority: string;
  defaultCategory: string;
  defaultDescription: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  defaultTitle: "",
  defaultPriority: "medium",
  defaultCategory: "other",
  defaultDescription: "",
};

function TemplateRow({
  template,
  canEdit,
  onUpdated,
  onDeleted,
}: {
  template: TaskTemplate;
  canEdit: boolean;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<TemplateFormState>({
    name: template.name,
    defaultTitle: template.defaultTitle,
    defaultPriority: template.defaultPriority,
    defaultCategory: template.defaultCategory,
    defaultDescription: template.defaultDescription ?? "",
  });

  const { mutate: updateTemplate, isPending: isUpdating } = useUpdateTaskTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template updated" });
        setIsEditing(false);
        onUpdated();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to update template", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: deleteTemplate, isPending: isDeleting } = useDeleteTaskTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template deleted" });
        onDeleted();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
      },
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    updateTemplate({
      id: template.id,
      data: {
        name: form.name.trim(),
        defaultTitle: form.defaultTitle.trim(),
        defaultPriority: form.defaultPriority as "low" | "medium" | "high" | "critical",
        defaultCategory: form.defaultCategory as "incident" | "change" | "maintenance" | "deployment" | "support" | "other",
        defaultDescription: form.defaultDescription.trim() || null,
      },
    });
  }

  if (isEditing) {
    return (
      <form onSubmit={handleSave} className="space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
        <div className="space-y-1">
          <Label className="text-xs">Template name <span className="text-destructive">*</span></Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Database Outage Response"
            maxLength={200}
            autoFocus
            className="h-8 text-sm"
            disabled={isUpdating}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Default title</Label>
          <Input
            value={form.defaultTitle}
            onChange={(e) => setForm((f) => ({ ...f, defaultTitle: e.target.value }))}
            placeholder="e.g. [SERVICE] outage — investigate and restore"
            maxLength={500}
            className="h-8 text-sm"
            disabled={isUpdating}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Default priority</Label>
            <Select
              value={form.defaultPriority}
              onValueChange={(v) => setForm((f) => ({ ...f, defaultPriority: v }))}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default category</Label>
            <Select
              value={form.defaultCategory}
              onValueChange={(v) => setForm((f) => ({ ...f, defaultCategory: v }))}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Default description / runbook steps</Label>
          <MarkdownEditor
            value={form.defaultDescription}
            onChange={(md) => setForm((f) => ({ ...f, defaultDescription: md }))}
            placeholder="Checklist or steps to follow when this template is used..."
            readOnly={isUpdating}
            className="h-48 border border-input rounded-md overflow-hidden"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isUpdating || !form.name.trim()}>
            {isUpdating ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isUpdating}
            onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{template.name}</p>
        {template.defaultTitle && (
          <p className="text-xs text-muted-foreground mt-0.5">Title: {template.defaultTitle}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] py-0 capitalize">{template.defaultPriority}</Badge>
          <Badge variant="outline" className="text-[10px] py-0 capitalize">{template.defaultCategory}</Badge>
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsEditing(true)}
            title="Edit template"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title="Delete template"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{template.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This template will be permanently deleted. Tasks created from it won't be affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteTemplate({ id: template.id })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

// ─── Workflow Stages Card ─────────────────────────────────────────────────────

function WorkflowStagesCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stages = [], isLoading } = useListWorkflowStages();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6b7280");
  const [editType, setEditType] = useState<"open" | "closed">("open");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [newType, setNewType] = useState<"open" | "closed">("open");
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStage | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>("");

  const { mutate: createStage, isPending: isCreatingStage } = useCreateWorkflowStage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Stage created" });
        setIsCreating(false);
        setNewName("");
        setNewColor("#6b7280");
        setNewType("open");
        queryClient.invalidateQueries({ queryKey: getListWorkflowStagesQueryKey() });
      },
      onError: (e: unknown) => toast({ title: "Failed to create stage", description: String((e as { message?: string })?.message ?? e), variant: "destructive" }),
    },
  });

  const { mutate: updateStage, isPending: isUpdatingStage } = useUpdateWorkflowStage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Stage updated" });
        setEditingId(null);
        queryClient.invalidateQueries({ queryKey: getListWorkflowStagesQueryKey() });
      },
      onError: (e: unknown) => toast({ title: "Failed to update stage", description: String((e as { message?: string })?.message ?? e), variant: "destructive" }),
    },
  });

  const { mutate: performDelete, isPending: isDeletingStage } = useMutation({
    mutationFn: async ({ id, reassignTo }: { id: number; reassignTo?: number }) => {
      const url = reassignTo
        ? `/api/workflow-stages/${id}?reassignTo=${reassignTo}`
        : `/api/workflow-stages/${id}`;
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? res.statusText);
      }
    },
    onSuccess: () => {
      toast({ title: "Stage deleted" });
      setDeleteTarget(null);
      setReassignTarget("");
      queryClient.invalidateQueries({ queryKey: getListWorkflowStagesQueryKey() });
    },
    onError: (e: unknown) => toast({ title: "Failed to delete stage", description: String((e as { message?: string })?.message ?? e), variant: "destructive" }),
  });

  const { mutate: reorderStages } = useReorderWorkflowStages({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWorkflowStagesQueryKey() }),
      onError: (e: unknown) => toast({ title: "Failed to reorder stages", description: String((e as { message?: string })?.message ?? e), variant: "destructive" }),
    },
  });

  function startEdit(s: WorkflowStage) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
    setEditType(s.type as "open" | "closed");
  }

  function moveStage(index: number, direction: "up" | "down") {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sorted.length) return;
    const ids = sorted.map((s) => s.id);
    ids.splice(newIndex, 0, ids.splice(index, 1)[0]);
    reorderStages({ data: { ids } });
  }

  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const activeStages = sorted.filter((s) => !s.archivedAt);
  const archivedStages = sorted.filter((s) => s.archivedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Workflow className="w-4 h-4" />
          Workflow Stages
        </CardTitle>
        <CardDescription>
          Define the stages tasks move through in your organisation. Each stage has a name, colour,
          and type (open or closed). Closed stages count as resolved for SLA and dashboard metrics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {sorted.map((stage, index) => {
          const isEditing = editingId === stage.id;
          const isActive = !stage.archivedAt;
          return (
            <div key={stage.id} className={`flex items-center gap-3 p-3 rounded-lg border ${isActive ? "border-border bg-background" : "border-dashed border-border/50 bg-muted/30"}`}>
              {/* Color dot */}
              <div className="w-4 h-4 rounded-full shrink-0 border border-border/50" style={{ backgroundColor: isEditing ? editColor : stage.color }} />

              {isEditing ? (
                /* ── Edit mode ── */
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 w-36 text-sm"
                    placeholder="Stage name"
                    maxLength={50}
                  />
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">Color</label>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border border-border"
                    />
                  </div>
                  <Select value={editType} onValueChange={(v) => setEditType(v as "open" | "closed")}>
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-7 text-xs" disabled={isUpdatingStage || !editName.trim()} onClick={() => updateStage({ id: stage.id, data: { name: editName.trim(), color: editColor, type: editType } })}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              ) : (
                /* ── View mode ── */
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <span className={`text-sm font-medium truncate ${!isActive ? "text-muted-foreground line-through" : ""}`}>{stage.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${stage.type === "closed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                    {stage.type}
                  </span>
                  {!isActive && <span className="text-xs text-muted-foreground">(archived)</span>}
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Move up" disabled={index === 0} onClick={() => moveStage(index, "up")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Move down" disabled={index === sorted.length - 1} onClick={() => moveStage(index, "down")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => startEdit(stage)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={isActive ? "Archive" : "Unarchive"} onClick={() => updateStage({ id: stage.id, data: { archived: isActive } })}>
                    {isActive ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={() => { setDeleteTarget(stage); setReassignTarget(""); }} disabled={!isActive}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {/* Create new stage */}
        {isCreating ? (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Stage name"
              className="h-7 w-36 text-sm"
              maxLength={50}
              autoFocus
            />
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">Color</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-border"
              />
            </div>
            <Select value={newType} onValueChange={(v) => setNewType(v as "open" | "closed")}>
              <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-xs" disabled={isCreatingStage || !newName.trim()} onClick={() => createStage({ data: { name: newName.trim(), color: newColor, type: newType } })}>
              Add
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setIsCreating(false); setNewName(""); }}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs mt-1" onClick={() => setIsCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> Add stage
          </Button>
        )}

        {/* Delete confirmation dialog */}
        {deleteTarget && (
          <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setReassignTarget(""); } }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{deleteTarget.name}"?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span>This stage will be permanently removed.</span>
                  {activeStages.filter((s) => s.id !== deleteTarget.id).length > 0 && (
                    <span className="block mt-2">
                      Select a stage to reassign existing tasks (leave blank to keep current status string):
                      <Select value={reassignTarget} onValueChange={setReassignTarget}>
                        <SelectTrigger className="h-8 mt-2"><SelectValue placeholder="Reassign tasks to…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">No reassignment</SelectItem>
                          {activeStages.filter((s) => s.id !== deleteTarget.id).map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isDeletingStage}
                  onClick={() => performDelete({ id: deleteTarget.id, reassignTo: reassignTarget ? Number(reassignTarget) : undefined })}
                >
                  {isDeletingStage ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

function TaskTemplatesCard() {
  const { toast } = useToast();
  const { data: templates = [], isLoading, refetch } = useListTaskTemplates();
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);

  const { mutate: createTemplate, isPending: isCreatingReq } = useCreateTaskTemplate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Template created" });
        setIsCreating(false);
        setForm(EMPTY_TEMPLATE_FORM);
        refetch();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to create template", description: err.message, variant: "destructive" });
      },
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createTemplate({
      data: {
        name: form.name.trim(),
        defaultTitle: form.defaultTitle.trim() || undefined,
        defaultPriority: form.defaultPriority as "low" | "medium" | "high" | "critical",
        defaultCategory: form.defaultCategory as "incident" | "change" | "maintenance" | "deployment" | "support" | "other",
        defaultDescription: form.defaultDescription.trim() || undefined,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Task Templates
            </CardTitle>
            <CardDescription className="mt-1">
              Define reusable starting points for common tasks. Members can pick a template when
              creating a task to pre-fill the title, priority, category, and description.
            </CardDescription>
          </div>
          {!isCreating && (
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setIsCreating(true)}>
              <Plus className="w-3.5 h-3.5" />
              New template
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isCreating && (
          <form onSubmit={handleCreate} className="space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5 mb-4">
            <p className="text-sm font-medium">New template</p>
            <div className="space-y-1">
              <Label className="text-xs">Template name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Database Outage Response"
                maxLength={200}
                autoFocus
                className="h-8 text-sm"
                disabled={isCreatingReq}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default title</Label>
              <Input
                value={form.defaultTitle}
                onChange={(e) => setForm((f) => ({ ...f, defaultTitle: e.target.value }))}
                placeholder="e.g. [SERVICE] outage — investigate and restore"
                maxLength={500}
                className="h-8 text-sm"
                disabled={isCreatingReq}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Default priority</Label>
                <Select
                  value={form.defaultPriority}
                  onValueChange={(v) => setForm((f) => ({ ...f, defaultPriority: v }))}
                  disabled={isCreatingReq}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Default category</Label>
                <Select
                  value={form.defaultCategory}
                  onValueChange={(v) => setForm((f) => ({ ...f, defaultCategory: v }))}
                  disabled={isCreatingReq}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default description / runbook steps</Label>
              <MarkdownEditor
                value={form.defaultDescription}
                onChange={(md) => setForm((f) => ({ ...f, defaultDescription: md }))}
                placeholder="Checklist or steps to follow when this template is used..."
                readOnly={isCreatingReq}
                className="h-48 border border-input rounded-md overflow-hidden"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isCreatingReq || !form.name.trim()}>
                {isCreatingReq ? "Creating…" : "Create template"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={isCreatingReq}
                onClick={() => { setIsCreating(false); setForm(EMPTY_TEMPLATE_FORM); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : templates.length === 0 && !isCreating ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No templates yet. Create one to help your team start tasks faster.
          </p>
        ) : (
          <div>
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                canEdit={true}
                onUpdated={refetch}
                onDeleted={refetch}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── SlaPoliciesCard ──────────────────────────────────────────────────────────

const PRIORITY_LEVELS = [
  { value: "critical", label: "Critical", description: "Immediate response required" },
  { value: "high",     label: "High",     description: "Urgent operational issue" },
  { value: "medium",   label: "Medium",   description: "Standard work item" },
  { value: "low",      label: "Low",      description: "Low urgency, can be deferred" },
] as const;

type PriorityLevel = typeof PRIORITY_LEVELS[number]["value"];

interface PolicyDraft {
  responseMinutes: string;   // empty string means "no target"
  resolutionMinutes: string;
}

function minutesToDisplay(minutes: number | null | undefined): string {
  if (minutes == null) return "";
  return String(minutes);
}

function displayToMinutes(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function SlaPoliciesCard() {
  const { toast } = useToast();
  const { data: policies, isLoading, refetch } = useGetSLAPolicies();

  // Build draft state, initialized from server data once loaded
  const [draft, setDraft] = useState<Record<PriorityLevel, PolicyDraft> | null>(null);
  const [editing, setEditing] = useState(false);

  // Sync draft when policies load
  const buildDraft = (serverPolicies: SlaPolicy[]): Record<PriorityLevel, PolicyDraft> => {
    const map = new Map(serverPolicies.map((p) => [p.priority as PriorityLevel, p]));
    return Object.fromEntries(
      PRIORITY_LEVELS.map(({ value }) => {
        const p = map.get(value);
        return [value, {
          responseMinutes:   minutesToDisplay(p?.responseMinutes),
          resolutionMinutes: minutesToDisplay(p?.resolutionMinutes),
        }];
      }),
    ) as Record<PriorityLevel, PolicyDraft>;
  };

  const { mutate: upsertPolicies, isPending: isSaving } = useUpsertSLAPolicies({
    mutation: {
      onSuccess: () => {
        toast({ title: "SLA policies saved" });
        refetch();
        setEditing(false);
      },
      onError: (err: Error) => {
        toast({ title: "Failed to save SLA policies", description: err.message, variant: "destructive" });
      },
    },
  });

  function startEditing() {
    setDraft(buildDraft(policies ?? []));
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(null);
    setEditing(false);
  }

  function handleSave() {
    if (!draft) return;
    const entries = PRIORITY_LEVELS.map(({ value }) => ({
      priority: value as "low" | "medium" | "high" | "critical",
      responseMinutes: displayToMinutes(draft[value].responseMinutes),
      resolutionMinutes: displayToMinutes(draft[value].resolutionMinutes),
    })).filter((e) => e.responseMinutes != null || e.resolutionMinutes != null);

    upsertPolicies({ data: { policies: entries } });
  }

  function updateDraft(priority: PriorityLevel, field: keyof PolicyDraft, value: string) {
    setDraft((prev) => prev ? { ...prev, [priority]: { ...prev[priority], [field]: value } } : prev);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4" />
              SLA Policies
            </CardTitle>
            <CardDescription className="mt-1">
              Set response and resolution time targets for each priority level.
              Tasks that exceed these targets will be flagged as SLA-breached.
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={startEditing}>
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {PRIORITY_LEVELS.map(({ value }) => (
              <div key={value} className="h-12 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : editing && draft ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[120px_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground pb-1 border-b border-border">
              <span>Priority</span>
              <span>Response (min)</span>
              <span>Resolution (min)</span>
            </div>
            {PRIORITY_LEVELS.map(({ value, label }) => (
              <div key={value} className="grid grid-cols-[120px_1fr_1fr] gap-3 items-center">
                <span className="text-sm font-medium">{label}</span>
                <Input
                  type="number"
                  min={1}
                  placeholder="No target"
                  value={draft[value].responseMinutes}
                  onChange={(e) => updateDraft(value, "responseMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="No target"
                  value={draft[value].resolutionMinutes}
                  onChange={(e) => updateDraft(value, "resolutionMinutes", e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save policies"}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {PRIORITY_LEVELS.map(({ value, label, description }) => {
              const p = policies?.find((pol) => pol.priority === value);
              const hasPolicy = p && (p.responseMinutes != null || p.resolutionMinutes != null);
              return (
                <div key={value} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <div className="w-24 shrink-0">
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-[10px] text-muted-foreground">{description}</p>
                  </div>
                  {hasPolicy ? (
                    <div className="flex gap-4 text-sm flex-1">
                      {p.responseMinutes != null && (
                        <span className="text-muted-foreground">
                          Response: <strong className="text-foreground">{p.responseMinutes}m</strong>
                        </span>
                      )}
                      {p.resolutionMinutes != null && (
                        <span className="text-muted-foreground">
                          Resolution: <strong className="text-foreground">{p.resolutionMinutes}m</strong>
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground flex-1">No target set</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── OrgSettings page ─────────────────────────────────────────────────────────

export default function OrgSettings() {
  const { org, isAdmin, isOwner, hasPermission, refetchOrg } = useOrgContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const [inviteValue, setInviteValue] = useState("");
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePermissions, setNewRolePermissions] = useState<RolePermissions | null>(null);
  const [duplicateSourceName, setDuplicateSourceName] = useState("");

  // ── Rename state ────────────────────────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(org?.name ?? "");

  const { mutate: renameOrg, isPending: isRenaming } = useRenameOrg({
    mutation: {
      onSuccess: () => {
        toast({ title: "Organization renamed" });
        refetchOrg();
        setIsEditingName(false);
      },
      onError: (err: Error) => {
        toast({ title: "Failed to rename", description: err.message, variant: "destructive" });
      },
    },
  });

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === org?.name) { setIsEditingName(false); return; }
    renameOrg({ data: { name: trimmed } });
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  const { data: members = [], refetch: refetchMembers } = useListOrgMembers();
  const { data: invitations = [], refetch: refetchInvitations } = useListOrgInvitations();
  const { data: roles = [], refetch: refetchRoles } = useListRoles();

  const canManageMembers = hasPermission("manage_members");

  // Pending ownership transfer awaiting confirmation: { userId, roleId, name }
  const [pendingTransfer, setPendingTransfer] = useState<{ userId: string; roleId: string; name: string } | null>(null);

  const { mutate: updateMemberRole } = useUpdateOrgMemberRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated" });
        refetchMembers();
        refetchOrg();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: removeMember } = useRemoveOrgMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Member removed" });
        refetchMembers();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to remove member", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: cancelInvitation } = useCancelOrgInvitation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation cancelled" });
        refetchInvitations();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to cancel", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: inviteMember, isPending: isInviting } = useInviteOrgMember({
    mutation: {
      onSuccess: (data) => {
        const link = buildInviteLink(data.token);
        navigator.clipboard.writeText(link).catch(() => {});
        toast({
          title: "Invite link copied!",
          description: "Send this link to the invitee. They can also log in directly to accept if their email or user ID matches.",
        });
        setInviteValue("");
        refetchInvitations();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to invite", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: leaveOrg, isPending: isLeaving } = useLeaveOrg({
    mutation: {
      onSuccess: () => {
        toast({ title: "You have left the organization" });
        refetchOrg();
      },
      onError: (err: Error) => {
        toast({ title: "Cannot leave", description: err.message, variant: "destructive" });
      },
    },
  });

  // ── Roles management ────────────────────────────────────────────────────────
  const { mutate: createRole, isPending: isCreatingRoleReq } = useCreateRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role created" });
        setIsCreatingRole(false);
        setNewRoleName("");
        setNewRolePermissions(null);
        setDuplicateSourceName("");
        refetchRoles();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to create role", description: err.message, variant: "destructive" });
      },
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteValue.trim()) return;
    const val = inviteValue.trim();
    const isEmail = val.includes("@");
    inviteMember({ data: isEmail ? { email: val } : { userId: val } });
  }

  function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newRoleName.trim();
    if (!trimmed) return;
    // newRolePermissions is always set when the form is open (BLANK_PERMISSIONS
    // for a fresh role, cloned permissions for a duplicate).
    createRole({
      data: { name: trimmed, permissions: newRolePermissions ?? BLANK_PERMISSIONS },
    });
  }

  function handleNewRolePermToggle(key: PermKey, value: boolean) {
    setNewRolePermissions((prev) => ({ ...(prev ?? BLANK_PERMISSIONS), [key]: value }));
  }

  function handleDuplicate(source: Role) {
    setNewRoleName(`Copy of ${source.name}`);
    setNewRolePermissions(source.permissions as RolePermissions);
    setDuplicateSourceName(source.name);
    setIsCreatingRole(true);
  }

  function cancelCreateRole() {
    setIsCreatingRole(false);
    setNewRoleName("");
    setNewRolePermissions(null);
    setDuplicateSourceName("");
  }

  function getDisplayName(m: OrgMemberInfo) {
    if (m.firstName || m.lastName) return [m.firstName, m.lastName].filter(Boolean).join(" ");
    return m.email ?? m.userId;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Building2 className="w-7 h-7 text-primary" />
          Organization Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          {isOwner
            ? "Manage your organization, members, and roles."
            : isAdmin
            ? "Manage projects, tasks, and team configuration."
            : "View your organization and its members."}
        </p>
      </div>

      {/* Org Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              {isOwner && isEditingName ? (
                <form onSubmit={handleRenameSubmit} className="flex items-center gap-2">
                  <Input
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setNameValue(org?.name ?? ""); setIsEditingName(false); } }}
                    autoFocus maxLength={200}
                    className="h-8 text-sm font-semibold"
                    disabled={isRenaming}
                  />
                  <Button type="submit" size="sm" disabled={isRenaming || !nameValue.trim()}>
                    {isRenaming ? "Saving…" : "Save"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost"
                    onClick={() => { setNameValue(org?.name ?? ""); setIsEditingName(false); }}
                    disabled={isRenaming}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate">{org?.name}</p>
                  {isOwner && (
                    <Button variant="ghost" size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => { setNameValue(org?.name ?? ""); setIsEditingName(true); }}
                      title="Rename organization">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{org?.id}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>{members.length} member{members.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((m) => {
            const isMe = m.userId === user?.id;
            return (
              <div key={m.userId} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center border border-border shrink-0 text-xs font-bold text-primary">
                  {m.firstName?.[0] ?? m.email?.[0] ?? "?"}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{getDisplayName(m)}</span>
                    {isMe && <Badge variant="outline" className="text-xs shrink-0">You</Badge>}
                  </div>
                  {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                </div>
                {/* Role badge or selector */}
                {canManageMembers && !isMe && (isOwner || m.roleName !== "Owner") ? (
                  <Select
                    value={m.roleId}
                    onValueChange={(roleId) => {
                      const selected = roles.find((r) => r.id === roleId);
                      if (selected?.isOwner) {
                        // Ownership transfer — require explicit confirmation
                        setPendingTransfer({ userId: m.userId, roleId, name: getDisplayName(m) });
                      } else {
                        updateMemberRole({ userId: m.userId, data: { roleId } });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles
                        .filter((r) => isOwner || !r.isOwner)
                        .map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-xs">
                            {r.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={roleBadgeVariant(m.roleName)} className="text-xs shrink-0 gap-1">
                    {m.roleName === "Owner" && <Crown className="w-3 h-3" />}
                    {m.roleName}
                  </Badge>
                )}
                {/* Remove */}
                {canManageMembers && !isMe && (isOwner || m.roleName !== "Owner") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Remove member">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove member?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {getDisplayName(m)} will lose access to this organization and all its projects.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => removeMember({ userId: m.userId })}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Ownership transfer confirmation */}
      <AlertDialog open={pendingTransfer !== null} onOpenChange={(open) => { if (!open) setPendingTransfer(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTransfer?.name} will become the Owner of this organization, and your role will
              change to Admin. There can only be one Owner. This action can only be undone by the new Owner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingTransfer) {
                  updateMemberRole({ userId: pendingTransfer.userId, data: { roleId: pendingTransfer.roleId } });
                }
                setPendingTransfer(null);
              }}
            >
              Transfer ownership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pending invitations */}
      {isAdmin && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pending invitations
            </CardTitle>
            <CardDescription>{invitations.length} awaiting response</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {invitations.map((inv) => {
              const recipient = inv.invitedEmail ?? inv.invitedUserId ?? "Unknown";
              const expiresAt = new Date(inv.expiresAt);
              const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
              return (
                <div key={inv.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center border border-border shrink-0 text-xs font-bold text-muted-foreground">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{recipient}</p>
                    <p className="text-xs text-muted-foreground">Expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">Pending</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                    title="Copy invite link"
                    onClick={() => {
                      navigator.clipboard.writeText(buildInviteLink(inv.token)).catch(() => {});
                      toast({ title: "Invite link copied" });
                    }}>
                    <Link2 className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" title="Cancel invitation">
                        <X className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel invitation?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The invitation to <strong>{recipient}</strong> will be cancelled.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep invitation</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => cancelInvitation({ id: inv.id })}
                        >
                          Cancel invitation
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Invite */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              Invite a member
            </CardTitle>
            <CardDescription>
              Enter an email address or Replit user ID to invite someone to your organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="email@example.com or user ID"
                  value={inviteValue}
                  onChange={(e) => setInviteValue(e.target.value)}
                  disabled={isInviting}
                />
              </div>
              <Button type="submit" disabled={isInviting || !inviteValue.trim()} className="gap-2">
                <Mail className="w-4 h-4" />
                {isInviting ? "Sending…" : "Send invite"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Roles */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Roles &amp; permissions
              </CardTitle>
              <CardDescription className="mt-1">
                {isOwner
                  ? "Define what each role can do. Built-in roles are read-only; create a custom role to apply different permissions."
                  : "Permission levels for each role in this organization."}
              </CardDescription>
            </div>
            {isOwner && !isCreatingRole && (
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => { setNewRolePermissions(BLANK_PERMISSIONS); setDuplicateSourceName(""); setIsCreatingRole(true); }}>
                <Plus className="w-3.5 h-3.5" />
                New role
              </Button>
            )}
          </div>
          {isOwner && isCreatingRole && (
            <form onSubmit={handleCreateRole} className="mt-4 rounded-lg border border-border bg-muted/30 p-4 space-y-4">
              {duplicateSourceName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Copy className="w-3 h-3 shrink-0" />
                  Copied permissions from <strong>{duplicateSourceName}</strong> — adjust below then save.
                </p>
              )}
              {/* Name row */}
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Role name"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  maxLength={100}
                  disabled={isCreatingRoleReq}
                  className="h-8 text-sm flex-1"
                />
                <Button type="submit" size="sm" disabled={isCreatingRoleReq || !newRoleName.trim()}>
                  {isCreatingRoleReq ? "Creating…" : "Create role"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelCreateRole}>
                  Cancel
                </Button>
              </div>
              {/* Permission groups */}
              <div className="space-y-3">
                {PERM_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">{group.label}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {group.keys.map((key) => (
                        <div key={key} className="flex items-center gap-2">
                          <Switch
                            id={`new-role-${key}`}
                            checked={newRolePermissions?.[key] ?? false}
                            onCheckedChange={(v) => handleNewRolePermToggle(key, v)}
                            disabled={isCreatingRoleReq}
                            className="h-4 w-7 data-[state=checked]:bg-primary"
                          />
                          <Label
                            htmlFor={`new-role-${key}`}
                            className="text-xs text-muted-foreground cursor-pointer"
                          >
                            {PERM_LABELS[key]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </form>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              canEdit={isOwner}
              members={members}
              onUpdated={refetchRoles}
              onDeleted={() => { refetchRoles(); refetchMembers(); }}
              onDuplicate={handleDuplicate}
            />
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No roles found.</p>
          )}
        </CardContent>
      </Card>

      {/* SLA Policies (admin only) */}
      {isAdmin && <SlaPoliciesCard />}

      {/* Workflow Stages (admin only) */}
      {isAdmin && <WorkflowStagesCard />}

      {/* Task Templates (admin only) */}
      {isAdmin && <TaskTemplatesCard />}

      {/* Custom Fields (admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              Custom Fields
            </CardTitle>
            <CardDescription>
              Define typed fields that appear on every task in your organization.
              Admins can create, rename, reorder, and delete fields.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomFieldsManager />
          </CardContent>
        </Card>
      )}

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveOrgSection
            orgName={org?.name ?? ""}
            isOwner={isOwner}
            isOnlyMember={members.length <= 1}
            isLeaving={isLeaving}
            onLeave={() => leaveOrg()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
