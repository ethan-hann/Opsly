import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { Search, Users, UserX, Shield } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useTranslation } from "react-i18next";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isInstanceAdmin: boolean;
  createdAt: string;
  orgs: Array<{ orgId: string; orgName: string; roleName: string }>;
}

async function fetchUsers(search: string): Promise<AdminUser[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (search) params.set("search", search);
  const res = await fetch(`${BASE}/api/admin/users?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

async function removeMember(orgId: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/orgs/${orgId}/members/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to remove member");
}

export function AdminUsersTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [confirmRemove, setConfirmRemove] = useState<{ user: AdminUser; orgId: string; orgName: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users", debouncedSearch],
    queryFn: () => fetchUsers(debouncedSearch),
  });

  const removeMutation = useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) => removeMember(orgId, userId),
    onSuccess: () => {
      setConfirmRemove(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('admin.users.colUser')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('admin.users.colOrgs')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('admin.users.colJoined')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {debouncedSearch ? t('admin.users.noUsersSearch') : t('admin.users.noUsers')}
                  </td>
                </tr>
              )}
              {users?.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                        {user.firstName?.[0] ?? user.email?.[0] ?? "?"}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">
                            {user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user.email ?? t('common.unknown')}
                          </span>
                          {user.isInstanceAdmin && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <Shield className="w-3 h-3" />
                              {t('admin.users.adminBadge')}
                            </Badge>
                          )}
                        </div>
                        {user.firstName && (
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        )}
                        <div className="text-xs text-muted-foreground font-mono">{user.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.orgs.length === 0 ? (
                        <span className="text-muted-foreground text-xs">{t('admin.users.noOrgs')}</span>
                      ) : (
                        user.orgs.map((org) => (
                          <div key={org.orgId} className="flex items-center gap-1 text-xs bg-muted rounded px-2 py-0.5">
                            <span>{org.orgName}</span>
                            <span className="text-muted-foreground">({org.roleName})</span>
                            <button
                              onClick={() =>
                                setConfirmRemove({ user, orgId: org.orgId, orgName: org.orgName })
                              }
                              className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                              title={t('admin.users.removeFromOrg')}
                            >
                              <UserX className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(user.createdAt).toLocaleDateString(i18n.language || undefined)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Remove member confirmation */}
      <AlertDialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.users.removeFromOrgTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.users.removeFromOrgDesc', {
                user: confirmRemove?.user.email ?? confirmRemove?.user.firstName ?? "",
                org: confirmRemove?.orgName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                confirmRemove &&
                removeMutation.mutate({ orgId: confirmRemove.orgId, userId: confirmRemove.user.id })
              }
              disabled={removeMutation.isPending}
            >
              {t('admin.users.removeButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
