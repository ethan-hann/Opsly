import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useGetMyOrg } from "@workspace/api-client-react";
import type { PendingInvitation, RolePermissions } from "@workspace/api-client-react";
import { OrgContext, type OrgContextValue } from "@/hooks/use-org-context";
import { OwnershipCelebration } from "@/components/ui/ownership-celebration";
import { OrgSuspendedPage } from "@/pages/org-suspended";

// ─── Guard ────────────────────────────────────────────────────────────────────

interface OrgGuardProps {
  children: ReactNode;
  /** Render prop - receives a stable `onCreated` callback that triggers an
   *  immediate refetch of the org query so the guard transitions without a
   *  full page reload. */
  onboarding: (onCreated: () => void) => ReactNode;
  invitation: (inv: PendingInvitation) => ReactNode;
}

export function OrgGuard({ children, onboarding, invitation }: OrgGuardProps) {
  const {
    data,
    isLoading,
    refetch,
  } = useGetMyOrg();

  const refetchOrg = useCallback(() => {
    refetch();
  }, [refetch]);

  // Long-interval poll as a fallback for missed SSE events (e.g. reconnects).
  // The SSE connection provides near-instant delivery for the common path.
  useEffect(() => {
    const id = setInterval(() => { refetch(); }, 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  // ── SSE connection ─────────────────────────────────────────────────────────
  // Open a persistent SSE connection so the server can push role-change events
  // instantly rather than waiting for the next poll cycle.
  useEffect(() => {
    // BASE_URL includes the trailing slash; strip it before appending the path.
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const url = `${base}/api/events`;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect() {
      if (!active) return;
      es = new EventSource(url, { withCredentials: true });

      es.addEventListener("role-changed", () => {
        refetch();
      });

      es.onerror = () => {
        es?.close();
        es = null;
        // Exponential-ish back-off capped at 30 s — reconnect after a brief pause
        if (active) {
          retryTimeout = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      active = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [refetch]);

  // ── Ownership transition detection ─────────────────────────────────────────
  // Track whether the current user was already an owner on the *previous*
  // render so we can detect the false→true transition during a live session.
  // null = not yet observed (initial mount), so we don't fire on page load.
  const prevIsOwner = useRef<boolean | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const permissions = data?.org ? (data.permissions ?? null) : null;
  const isOwner = data?.roleName === "Owner" && permissions?.manage_org_settings === true;

  useEffect(() => {
    if (prevIsOwner.current === false && isOwner) {
      setShowCelebration(true);
    }
    if (data?.org) {
      prevIsOwner.current = isOwner;
    }
  }, [isOwner, data?.org]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading organization…</p>
        </div>
      </div>
    );
  }

  // Pending invitation - show invitation screen
  if (data?.pendingInvitation) {
    return <>{invitation(data.pendingInvitation)}</>;
  }

  // No org - show onboarding; pass refetch as the onCreated callback so the
  // guard transitions immediately without relying on query-key matching.
  if (!data?.org) {
    return <>{onboarding(refetch)}</>;
  }

  // Org is suspended by instance admin
  if ((data.org as { isDisabled?: boolean }).isDisabled) {
    return <OrgSuspendedPage />;
  }

  function hasPermission(key: keyof RolePermissions): boolean {
    return permissions?.[key] === true;
  }

  // Has org - render main app with context
  const value: OrgContextValue = {
    org: data.org,
    roleId: data.roleId ?? null,
    roleName: data.roleName ?? null,
    permissions,
    pendingInvitation: null,
    isAdmin: hasPermission("manage_projects"),
    // roleName === "Owner" is the authoritative check; manage_org_settings is
    // Owner-only so it doubles as a safety guard against custom roles named "Owner".
    isOwner,
    hasPermission,
    refetchOrg,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
      <OwnershipCelebration
        open={showCelebration}
        onClose={() => setShowCelebration(false)}
        orgName={data.org.name}
      />
    </OrgContext.Provider>
  );
}
