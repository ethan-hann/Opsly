import { useState } from "react";
import {
  useListOrgMembers,
  useInviteOrgMember,
  useRemoveOrgMember,
  useUpdateOrgMemberRole,
  useLeaveOrg,
  useRenameOrg,
} from "@workspace/api-client-react";
import type { OrgMemberInfo } from "@workspace/api-client-react";
import { useOrgContext } from "@/hooks/use-org-context";
import { AlertTriangle, Building2, Crown, LogOut, Mail, Pencil, Trash2, UserPlus, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";

// ─── LeaveOrgSection ─────────────────────────────────────────────────────────

interface LeaveOrgSectionProps {
  orgName: string;
  isAdmin: boolean;
  isOnlyMember: boolean;
  isLeaving: boolean;
  onLeave: () => void;
}

function LeaveOrgSection({ orgName, isAdmin, isOnlyMember, isLeaving, onLeave }: LeaveOrgSectionProps) {
  // Case 1: sole member — leaving deletes the entire org and all its data
  if (isOnlyMember) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-destructive">This will permanently delete the organization</p>
            <p className="text-muted-foreground mt-0.5">
              You are the only member. Leaving will delete <strong>{orgName}</strong> and
              all of its projects, tasks, and notes. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Leave &amp; delete organization</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="gap-2"
                disabled={isLeaving}
              >
                <LogOut className="w-4 h-4" />
                {isLeaving ? "Deleting…" : "Leave & delete"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Delete organization?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      You are the only member of <strong>{orgName}</strong>. Leaving will
                      permanently delete the organization and <strong>all of its data</strong>:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>All projects</li>
                      <li>All tasks and comments</li>
                      <li>All notes</li>
                    </ul>
                    <p className="font-medium text-destructive">This cannot be undone.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onLeave}
                >
                  Delete organization
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  }

  // Case 2: admin with other members — must transfer admin first
  if (isAdmin) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">Admin role must be transferred first</p>
            <p className="text-muted-foreground mt-0.5">
              Use the Shield icon next to another member above to transfer admin, then you can leave.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Leave organization</p>
          <Button
            variant="outline"
            className="gap-2 border-destructive/40 text-destructive opacity-50 cursor-not-allowed"
            disabled
          >
            <LogOut className="w-4 h-4" />
            Leave
          </Button>
        </div>
      </div>
    );
  }

  // Case 3: regular member — standard confirmation
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">Leave organization</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          You will lose access to all projects, tasks, and notes.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="gap-2 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            disabled={isLeaving}
          >
            <LogOut className="w-4 h-4" />
            {isLeaving ? "Leaving…" : "Leave"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to <strong>{orgName}</strong> and all its projects,
              tasks, and notes. You can be re-invited by an admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onLeave}
            >
              Leave organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── OrgSettings page ─────────────────────────────────────────────────────────

export default function OrgSettings() {
  const { org, isAdmin, refetchOrg } = useOrgContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const [inviteValue, setInviteValue] = useState("");

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
    if (!trimmed || trimmed === org?.name) {
      setIsEditingName(false);
      return;
    }
    renameOrg({ data: { name: trimmed } });
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setNameValue(org?.name ?? "");
      setIsEditingName(false);
    }
  }

  const { data: members = [], refetch: refetchMembers } = useListOrgMembers();

  const { mutate: inviteMember, isPending: isInviting } = useInviteOrgMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation sent", description: `Invitation sent to ${inviteValue}.` });
        setInviteValue("");
      },
      onError: (err: Error) => {
        toast({ title: "Failed to send invitation", description: err.message, variant: "destructive" });
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

  const { mutate: updateRole } = useUpdateOrgMemberRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated", description: "Admin has been transferred." });
        refetchMembers();
        refetchOrg();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
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

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteValue.trim()) return;
    const val = inviteValue.trim();
    const isEmail = val.includes("@");
    inviteMember({ data: isEmail ? { email: val } : { userId: val } });
  }

  function getDisplayName(m: OrgMemberInfo) {
    if (m.firstName || m.lastName) {
      return [m.firstName, m.lastName].filter(Boolean).join(" ");
    }
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
        <p className="text-muted-foreground mt-1">Manage your organization and its members.</p>
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
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                    maxLength={200}
                    className="h-8 text-sm font-semibold"
                    disabled={isRenaming}
                  />
                  <Button type="submit" size="sm" disabled={isRenaming || !nameValue.trim()}>
                    {isRenaming ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setNameValue(org?.name ?? ""); setIsEditingName(false); }}
                    disabled={isRenaming}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate">{org?.name}</p>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => { setNameValue(org?.name ?? ""); setIsEditingName(true); }}
                      title="Rename organization"
                    >
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
            const isThisAdmin = m.role === "admin";
            return (
              <div
                key={m.userId}
                className="flex items-center gap-3 py-2 border-b border-border last:border-0"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center border border-border shrink-0 font-mono text-xs font-bold text-primary">
                  {m.firstName?.[0] ?? m.email?.[0] ?? "?"}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{getDisplayName(m)}</span>
                    {isMe && (
                      <Badge variant="outline" className="text-xs shrink-0">You</Badge>
                    )}
                  </div>
                  {m.email && (
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  )}
                </div>
                {/* Role badge */}
                <div className="shrink-0">
                  {isThisAdmin ? (
                    <Badge className="gap-1 text-xs">
                      <Crown className="w-3 h-3" />
                      Admin
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Member</Badge>
                  )}
                </div>
                {/* Actions (admin only, not on yourself) */}
                {isAdmin && !isMe && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Transfer admin */}
                    {!isThisAdmin && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Make admin">
                            <Shield className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Transfer admin role?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {getDisplayName(m)} will become the new admin. You will be demoted to member.
                              This cannot be undone without their action.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => updateRole({ userId: m.userId, data: { role: "admin" } })}
                            >
                              Transfer admin
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {/* Remove */}
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
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Invite (admin only) */}
      {isAdmin && (
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

      {/* Danger zone — leave org */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveOrgSection
            orgName={org?.name ?? ""}
            isAdmin={isAdmin}
            isOnlyMember={members.length <= 1}
            isLeaving={isLeaving}
            onLeave={() => leaveOrg()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
