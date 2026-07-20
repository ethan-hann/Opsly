import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw } from "lucide-react";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  disable_org: "destructive",
  enable_org: "secondary",
  delete_org: "destructive",
  toggle_feature: "outline",
  remove_member: "secondary",
};

async function fetchAuditLog(limit: number): Promise<AuditEntry[]> {
  const res = await fetch(`${BASE}/api/admin/audit-log?limit=${limit}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load audit log");
  return res.json();
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AdminAuditTab() {
  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: () => fetchAuditLog(100),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recent instance admin actions. Automatically refreshes every 15 seconds.
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
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
                <th className="px-4 py-3 text-left font-medium">Time</th>
                <th className="px-4 py-3 text-left font-medium">Actor</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Target</th>
                <th className="px-4 py-3 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No admin actions recorded yet
                  </td>
                </tr>
              )}
              {entries?.map((entry) => (
                <tr key={entry.id} className="font-mono text-xs">
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-sans">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{entry.actor}</span>
                  </td>
                  <td className="px-4 py-2.5 font-sans">
                    <Badge
                      variant={(ACTION_COLORS[entry.action] as "destructive" | "secondary" | "outline") ?? "outline"}
                      className="text-xs"
                    >
                      {formatAction(entry.action)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <span className="text-foreground">{entry.targetType}</span>:{entry.targetId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {entry.metadata ? JSON.stringify(entry.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
