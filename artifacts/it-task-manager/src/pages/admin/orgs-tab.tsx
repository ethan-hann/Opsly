import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import { Building2, Trash2, Power, PowerOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface AdminOrg {
  id: string;
  name: string;
  isDisabled: boolean;
  createdAt: string;
  memberCount: number;
  taskCount: number;
}

async function fetchOrgs(): Promise<AdminOrg[]> {
  const res = await fetch(`${BASE}/api/admin/orgs`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load orgs");
  return res.json();
}

async function patchOrg(id: string, isDisabled: boolean): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/orgs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ isDisabled }),
  });
  if (!res.ok) throw new Error("Failed to update org");
}

async function deleteOrg(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/orgs/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete org");
}

export function AdminOrgsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: orgs, isLoading, refetch } = useQuery({ queryKey: ["admin-orgs"], queryFn: fetchOrgs });
  const [confirmDelete, setConfirmDelete] = useState<AdminOrg | null>(null);

  const toggleMutation = useMutation({
    mutationFn: ({ id, isDisabled }: { id: string; isDisabled: boolean }) => patchOrg(id, isDisabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-orgs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOrg(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-orgs"] });
    },
  });

  const handleToggle = useCallback(
    (org: AdminOrg) => toggleMutation.mutate({ id: org.id, isDisabled: !org.isDisabled }),
    [toggleMutation],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('admin.orgs.orgCount', { count: orgs?.length ?? 0 })}
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('admin.orgs.refresh')}
        </Button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('admin.orgs.colOrganization')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.orgs.colMembers')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.orgs.colTasks')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.orgs.colCreated')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.orgs.colStatus')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.orgs.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orgs?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {t('admin.orgs.noOrgs')}
                </td>
              </tr>
            )}
            {orgs?.map((org) => (
              <tr key={org.id} className={org.isDisabled ? "opacity-60 bg-muted/20" : ""}>
                <td className="px-4 py-3">
                  <div>
                    <span className="font-medium">{org.name}</span>
                    <div className="text-xs text-muted-foreground font-mono">{org.id}</div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">{org.memberCount}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{org.taskCount}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(org.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {org.isDisabled ? (
                    <Badge variant="destructive">{t('admin.orgs.statusSuspended')}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-green-600 border-green-600">{t('admin.orgs.statusActive')}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggle(org)}
                      disabled={toggleMutation.isPending}
                    >
                      {org.isDisabled ? (
                        <><Power className="w-3.5 h-3.5 mr-1" />{t('admin.orgs.enable')}</>
                      ) : (
                        <><PowerOff className="w-3.5 h-3.5 mr-1" />{t('admin.orgs.suspend')}</>
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDelete(org)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.orgs.deleteOrg')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.orgs.deleteOrgDesc', { name: confirmDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {t('admin.orgs.deleteButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
