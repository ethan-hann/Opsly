import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, RefreshCw, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

type OrgFeature = "webhooks" | "api_keys" | "custom_fields" | "custom_statuses" | "sla_tracking" | "branding" | "task_trees";

interface AdminOrg {
  id: string;
  name: string;
  isDisabled: boolean;
}

async function fetchOrgs(): Promise<AdminOrg[]> {
  const res = await fetch(`${BASE}/api/admin/orgs`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load orgs");
  return res.json();
}

async function fetchFeatures(orgId: string): Promise<Record<OrgFeature, boolean>> {
  const res = await fetch(`${BASE}/api/admin/orgs/${orgId}/features`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load features");
  return res.json();
}

async function patchFeature(orgId: string, feature: OrgFeature, enabled: boolean): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/orgs/${orgId}/features`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ feature, enabled }),
  });
  if (!res.ok) throw new Error("Failed to update feature");
}

function OrgFeaturePanel({ org }: { org: AdminOrg }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: features, isLoading } = useQuery({
    queryKey: ["admin-features", org.id],
    queryFn: () => fetchFeatures(org.id),
  });

  const FEATURES: Array<{ key: OrgFeature; label: string; description: string }> = [
    { key: "webhooks", label: t('admin.features.featureWebhooks'), description: t('admin.features.featureWebhooksDesc') },
    { key: "api_keys", label: t('admin.features.featureApiKeys'), description: t('admin.features.featureApiKeysDesc') },
    { key: "custom_fields", label: t('admin.features.featureCustomFields'), description: t('admin.features.featureCustomFieldsDesc') },
    { key: "custom_statuses", label: t('admin.features.featureCustomStatuses'), description: t('admin.features.featureCustomStatusesDesc') },
    { key: "sla_tracking", label: t('admin.features.featureSlaTracking'), description: t('admin.features.featureSlaTrackingDesc') },
    { key: "branding", label: t('admin.features.featureBranding'), description: t('admin.features.featureBrandingDesc') },
    { key: "task_trees", label: "Task Trees", description: "Task dependency linking and hierarchy tree views" },
  ];

  const mutation = useMutation({
    mutationFn: ({ feature, enabled }: { feature: OrgFeature; enabled: boolean }) =>
      patchFeature(org.id, feature, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-features", org.id] }),
  });

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-muted/50 px-4 py-3 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">{org.name}</span>
        {org.isDisabled && <Badge variant="destructive" className="ml-auto">{t('admin.orgs.statusSuspended')}</Badge>}
      </div>
      <div className="divide-y divide-border">
        {FEATURES.map((feat) => {
          const enabled = features?.[feat.key] ?? true;
          const pending = mutation.isPending && mutation.variables?.feature === feat.key;
          return (
            <div key={feat.key} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-sm">{feat.label}</div>
                <div className="text-xs text-muted-foreground">{feat.description}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                <Switch
                  checked={enabled}
                  disabled={isLoading || pending}
                  onCheckedChange={(checked) =>
                    mutation.mutate({ feature: feat.key, enabled: checked })
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminFeaturesTab() {
  const { t } = useTranslation();
  const { data: orgs, isLoading, refetch } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: fetchOrgs,
  });

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
          {t('admin.features.featureDesc')}
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('admin.features.refresh')}
        </Button>
      </div>

      {orgs?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          {t('admin.features.noOrgs')}
        </div>
      )}

      <div className="space-y-4">
        {orgs?.map((org) => <OrgFeaturePanel key={org.id} org={org} />)}
      </div>
    </div>
  );
}
