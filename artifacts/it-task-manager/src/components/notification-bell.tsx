/**
 * NotificationBell — bell icon with unread badge + dropdown panel.
 *
 * Renders in the sidebar footer. Connects to the SSE stream to receive
 * `notification` events and update the badge without polling.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

type NotificationType =
  | "task_assigned"
  | "task_updated"
  | "comment_added"
  | "sla_breached"
  | "mention";

// ─── Types (local, no codegen needed for this feature) ───────────────────────

interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  entityType: string;
  entityId: number;
  read: boolean;
  actorName: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

async function fetchNotifications(
  signal?: AbortSignal,
): Promise<NotificationsResponse> {
  const res = await fetch(`${BASE}/api/notifications?limit=30`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json() as Promise<NotificationsResponse>;
}

async function markAllRead(): Promise<void> {
  await fetch(`${BASE}/api/notifications/read-all`, {
    method: "POST",
    credentials: "include",
  });
}

async function markOneRead(id: number): Promise<void> {
  await fetch(`${BASE}/api/notifications/${id}/read`, {
    method: "PATCH",
    credentials: "include",
  });
}

async function dismissOne(id: number): Promise<void> {
  await fetch(`${BASE}/api/notifications/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch(
    `${BASE}/api/notifications?limit=1&unreadOnly=true`,
    { credentials: "include" },
  );
  if (!res.ok) return 0;
  const data = (await res.json()) as NotificationsResponse;
  return data.unreadCount;
}

// ─── Notification type label helpers ─────────────────────────────────────────

function typeIcon(type: NotificationType): string {
  switch (type) {
    case "task_assigned":
      return "📋";
    case "task_updated":
      return "✏️";
    case "comment_added":
      return "💬";
    case "sla_breached":
      return "🚨";
    case "mention":
      return "👋";
    default:
      return "🔔";
  }
}

function entityLink(entityType: string, entityId: number): string {
  if (entityType === "task") return `/tasks/${entityId}`;
  if (entityType === "project") return `/projects/${entityId}`;
  return `/tasks`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NotificationBellProps {
  collapsed?: boolean;
}

export function NotificationBell({ collapsed = false }: NotificationBellProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load unread count on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchUnreadCount().then(setUnreadCount).catch(() => {});
  }, []);

  // ── SSE: update badge when a notification event arrives ────────────────────
  useEffect(() => {
    const url = `${BASE}/api/events`;
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect() {
      if (!active) return;
      es = new EventSource(url, { withCredentials: true });

      es.addEventListener("notification", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as {
            unread_count: number;
          };
          setUnreadCount(data.unread_count);
        } catch {
          // fallback: refetch count
          fetchUnreadCount().then(setUnreadCount).catch(() => {});
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
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
  }, []);

  // ── Load notifications when dropdown opens ─────────────────────────────────
  const loadNotifications = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const data = await fetchNotifications(abortRef.current.signal);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore abort errors
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    async (next: boolean) => {
      setOpen(next);
      if (next) {
        await loadNotifications();
      }
    },
    [loadNotifications],
  );

  // ── Mark all as read ───────────────────────────────────────────────────────
  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    // Invalidate any React Query caches that might show unread state
    queryClient.invalidateQueries({ queryKey: ["/notifications"] });
  }, [queryClient]);

  // ── Mark one as read ───────────────────────────────────────────────────────
  const handleMarkRead = useCallback(async (id: number) => {
    await markOneRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  // ── Dismiss ────────────────────────────────────────────────────────────────
  const handleDismiss = useCallback(async (id: number, wasUnread: boolean) => {
    await dismissOne(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const badgeCount = Math.min(unreadCount, 99);
  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className={
          collapsed
            ? "h-9 w-9 relative text-sidebar-foreground/60 hover:text-sidebar-foreground"
            : "h-8 w-8 relative text-sidebar-foreground/60 hover:text-sidebar-foreground shrink-0"
        }
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center leading-none">
            {badgeLabel}
          </span>
        )}
      </Button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {trigger}

      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-80 p-0 shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="h-[360px]">
          {loading ? (
            <div className="p-3 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
              <Bell className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={handleMarkRead}
                  onDismiss={handleDismiss}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex justify-end">
          <Link href="/settings/notifications">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Notification preferences
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Individual notification row ──────────────────────────────────────────────

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: number) => Promise<void>;
  onDismiss: (id: number, wasUnread: boolean) => Promise<void>;
  onNavigate: () => void;
}

function NotificationItem({
  notification: n,
  onMarkRead,
  onDismiss,
  onNavigate,
}: NotificationItemProps) {
  const href = entityLink(n.entityType, n.entityId);

  return (
    <div
      className={[
        "group flex items-start gap-2.5 px-3 py-3 hover:bg-muted/50 transition-colors",
        !n.read ? "bg-primary/5" : "",
      ].join(" ")}
    >
      {/* Type icon */}
      <span className="text-base leading-none mt-0.5 shrink-0">
        {typeIcon(n.type)}
      </span>

      {/* Body */}
      <Link href={href} className="flex-1 min-w-0" onClick={onNavigate}>
        <p className="text-xs leading-snug text-foreground line-clamp-2">
          {n.message}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </p>
      </Link>

      {/* Actions */}
      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!n.read && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            title="Mark as read"
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(n.id);
            }}
          >
            <Check className="w-3 h-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-destructive/70 hover:text-destructive"
          title="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(n.id, !n.read);
          }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
