import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, RefreshCw, Loader2 } from "lucide-react";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

type OrgFeature = "webhooks" | "api_keys" | "data_export" | "custom_fields" | "custom_statuses" | "sla_tracking";

const FEATURES: Array<{ key: OrgFeature; label: string; description: string }> = [
  { key: "webhooks", label: "Webhooks", description: "Inbound and outbound webhook management" },
  { key: "api_keys", label: "API Keys", description: "Programmatic API access via API keys" },
  { key: "data_export", label: "Data Export", description: "Export tasks, projects, and comments as ZIP/CSV" },
  { key: "custom_fields", label: "Custom Fields", description: "Custom field definitions on tasks" },
  { key: "custom_statuses", label: "Custom Statuses", description: "Custom workflow stage definitions" },
  { key: "sla_tracking", label: "SLA Tracking", description: "SLA policies and breach detection" },
];

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
  const qc = useQueryClient();
  const { data: features, isLoading } = useQuery({
    queryKey: ["admin-features", org.id],
    queryFn: () => fetchFeatures(org.id),
  });

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
        {org.isDisabled && <Badge variant="destructive" className="ml-auto">Suspended</Badge>}
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
          Toggle features per organization. Disabled features return 403 to all org members.
          All features are enabled by default.
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {orgs?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No organizations found
        </div>
      )}

      <div className="space-y-4">
        {orgs?.map((org) => <OrgFeaturePanel key={org.id} org={org} />)}
      </div>
    </div>
  );
}
