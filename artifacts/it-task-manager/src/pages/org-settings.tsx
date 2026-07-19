import { useState } from "react";
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
} from "@workspace/api-client-react";
import type { OrgMemberInfo, Role, RolePermissions } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import {
  AlertTriangle, Building2, Clock, Crown, Link2, LogOut,
  Mail, Pencil, Plus, Settings2, Shield, Sliders, Trash2, UserPlus, X,
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
  onUpdated: () => void;
  onDeleted: () => void;
}

function RoleCard({ role, canEdit, onUpdated, onDeleted }: RoleCardProps) {
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

  const isImmutable = role.isOwner;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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
            <div className="flex items-center gap-2">
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
                <AlertDialogDescription>
                  All members assigned to this role will be automatically reassigned to the Member
                  built-in role. This cannot be undone.
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

// ─── OrgSettings page ─────────────────────────────────────────────────────────

export default function OrgSettings() {
  const { org, isAdmin, isOwner, hasPermission, refetchOrg } = useOrgContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const [inviteValue, setInviteValue] = useState("");
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

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
    createRole({ data: { name: trimmed } });
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
          {isAdmin
            ? "Manage your organization, members, and roles."
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
              {isAdmin && isEditingName ? (
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
                  {isAdmin && (
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
                {canManageMembers && !isMe ? (
                  <Select
                    value={m.roleId}
                    onValueChange={(roleId) =>
                      updateMemberRole({ userId: m.userId, data: { roleId } })
                    }
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
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
                {canManageMembers && !isMe && (
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
                  ? "Define what each role can do. Built-in roles can have their permissions adjusted; the Owner role is immutable."
                  : "Permission levels for each role in this organization."}
              </CardDescription>
            </div>
            {isOwner && !isCreatingRole && (
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setIsCreatingRole(true)}>
                <Plus className="w-3.5 h-3.5" />
                New role
              </Button>
            )}
          </div>
          {isOwner && isCreatingRole && (
            <form onSubmit={handleCreateRole} className="mt-3 flex gap-2">
              <Input
                autoFocus
                placeholder="Role name"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                maxLength={100}
                disabled={isCreatingRoleReq}
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" disabled={isCreatingRoleReq || !newRoleName.trim()}>
                {isCreatingRoleReq ? "Creating…" : "Create"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setIsCreatingRole(false); setNewRoleName(""); }}>
                Cancel
              </Button>
            </form>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              canEdit={isOwner}
              onUpdated={refetchRoles}
              onDeleted={() => { refetchRoles(); refetchMembers(); }}
            />
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No roles found.</p>
          )}
        </CardContent>
      </Card>

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
