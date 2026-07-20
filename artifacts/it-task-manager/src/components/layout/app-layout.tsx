import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  CheckSquare,
  FolderGit2,
  StickyNote,
  Menu,
  Moon,
  Sun,
  Activity,
  LogOut,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  Webhook,
  Bookmark,
  Globe,
  Lock,
  Pencil,
  Trash2,
  Star,
  ChevronRight,
  Search,
} from "lucide-react";
import { useTheme } from "../theme-provider";
import { useAuth } from "@workspace/replit-auth-web";
import { useOrgContext } from "@/hooks/use-org-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { useListViews, useUpdateView, useDeleteView } from "@workspace/api-client-react";
import type { SavedView } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { NotificationBell } from "@/components/notification-bell";
import { useGlobalSearch } from "@/hooks/use-global-search";

const mainNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/notes", label: "Scratch Pad", icon: StickyNote },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
];

const externalNavItems = [
  { href: "/api/docs", label: "API Docs", icon: BookOpen },
];

function readCollapsed() {
  try {
    return localStorage.getItem("sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem("sidebar-collapsed", String(v));
  } catch {
    /* ignore */
  }
}

/** Build the /tasks URL with a saved view's filters applied */
function viewHref(view: SavedView): string {
  const params = new URLSearchParams();
  const f = view.filters;
  if (f.status) params.set("status", f.status);
  if (f.priority) params.set("priority", f.priority);
  if (f.category) params.set("category", f.category);
  if (f.assignee) params.set("assignee", f.assignee);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  if (f.projectFilter && f.projectFilter !== "all") params.set("project", f.projectFilter);
  if (f.search) params.set("search", f.search);
  params.set("viewId", String(view.id));
  return "/tasks?" + params.toString();
}

// ─── Saved Views Sidebar Section ──────────────────────────────────────────────

interface ViewsSectionProps {
  collapsed: boolean;
  userId: string | undefined;
  canAdmin: boolean;
}

function ViewsSection({ collapsed, userId, canAdmin }: ViewsSectionProps) {
  const [location] = useLocation();
  const { data: views } = useListViews();
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  if (!views || views.length === 0) return null;

  // Determine active view from URL
  const urlParams = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
  const activeViewId = urlParams.get("viewId") ? Number(urlParams.get("viewId")) : null;

  const handleRename = async (viewId: number) => {
    if (!editingName.trim()) return;
    await updateView.mutateAsync({ id: viewId, data: { name: editingName.trim() } });
    setEditingId(null);
    setEditingName("");
  };

  const handleDelete = async (viewId: number) => {
    await deleteView.mutateAsync({ id: viewId });
  };

  const handleToggleDefault = async (view: SavedView) => {
    await updateView.mutateAsync({ id: view.id, data: { isDefault: !view.isDefault } });
  };

  if (collapsed) {
    // In collapsed mode: show a single Bookmark icon with tooltip
    return (
      <div className="pt-2 mt-1 border-t border-sidebar-border/50">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center py-1.5">
              <Bookmark className="w-4 h-4 text-sidebar-foreground/50" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Saved Views ({views.length})</p>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="pt-2 mt-1 border-t border-sidebar-border/50">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center justify-between w-full px-3 py-1 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider hover:text-sidebar-foreground/70 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Bookmark className="w-3 h-3" />
          Views
        </span>
        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {views.map((view) => {
            const isActive = view.id === activeViewId;
            const canEdit = view.createdBy === userId || canAdmin;

            if (editingId === view.id) {
              return (
                <div key={view.id} className="px-2 py-1 flex gap-1">
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-6 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(view.id);
                      if (e.key === "Escape") { setEditingId(null); setEditingName(""); }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs shrink-0"
                    onClick={() => handleRename(view.id)}
                    disabled={updateView.isPending}
                  >
                    OK
                  </Button>
                </div>
              );
            }

            return (
              <Link key={view.id} href={viewHref(view)}>
                <div
                  className={[
                    "group flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors cursor-pointer text-xs",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  ].join(" ")}
                >
                  {/* Visibility icon */}
                  {view.isOrgWide ? (
                    <Globe className="w-3 h-3 shrink-0 opacity-50" />
                  ) : (
                    <Lock className="w-3 h-3 shrink-0 opacity-50" />
                  )}

                  <span className="flex-1 truncate">{view.name}</span>

                  {view.isDefault && (
                    <Star className="w-3 h-3 shrink-0 text-amber-500" fill="currentColor" />
                  )}

                  {/* Edit/delete controls — show on hover for owned views */}
                  {canEdit && (
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      {/* Only show star toggle when view is NOT already the default */}
                      {!view.isDefault && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleToggleDefault(view);
                          }}
                          className="p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-sidebar-accent transition-colors"
                          title="Set as default"
                        >
                          <Star className="w-3 h-3" fill="none" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingId(view.id);
                          setEditingName(view.name);
                        }}
                        className="p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-sidebar-accent transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(view.id);
                        }}
                        className="p-0.5 rounded opacity-50 hover:opacity-100 hover:text-destructive hover:bg-sidebar-accent transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { isAdmin, org } = useOrgContext();
  const { open: openSearch } = useGlobalSearch();

  // Mobile: drawer open/closed
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: collapsed (icon rail) vs expanded
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const toggleCollapse = () =>
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });

  const allNavItems = [
    ...mainNavItems,
    { href: "/org/settings", label: "Org Settings", icon: Settings },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      {/* Root - full height on desktop, natural height on mobile */}
      <div className="flex flex-col md:flex-row md:h-[100dvh] min-h-[100dvh] bg-background text-foreground font-sans">
        {/* ── Mobile top bar ─────────────────────────────────────────────── */}
        <header className="md:hidden shrink-0 h-14 flex items-center justify-between px-4 border-b border-border bg-card z-20">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-primary-foreground shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-semibold tracking-tight truncate">
              Opsly
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Search (Ctrl+K)"
              onClick={openSearch}
            >
              <Search className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Menu className="w-5 h-5" />
            </Button>
          </div>
        </header>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={[
            // base
            "fixed md:relative md:sticky top-14 md:top-0 left-0 z-10 h-[calc(100dvh-3.5rem)] md:h-[100dvh]",
            "border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
            "flex flex-col transition-all duration-200 ease-in-out shrink-0",
            // mobile: always full-width when open, hidden otherwise
            "w-64",
            mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
            // desktop: collapsed = icon rail (w-14), expanded = w-64
            collapsed ? "md:w-14" : "md:w-64",
          ].join(" ")}
        >
          {/* Header row (desktop only) */}
          <div
            className={`hidden md:flex items-center border-b border-sidebar-border shrink-0 h-[61px] ${collapsed ? "justify-center px-2" : "px-5 gap-3"}`}
          >
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="font-bold tracking-tight leading-tight">
                    Opsly
                  </p>
                  {org && (
                    <p className="text-xs text-sidebar-foreground/50 truncate">
                      {org.name}
                    </p>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                      onClick={toggleCollapse}
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Collapse sidebar</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          {/* Expand button when collapsed (desktop) */}
          {collapsed && (
            <div className="hidden md:flex justify-center py-2 border-b border-sidebar-border shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                    onClick={toggleCollapse}
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Expand sidebar</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Nav */}
          <nav
            className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}
          >
            {/* Search trigger */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={openSearch}
                    aria-label="Search (⌘K)"
                    className="flex justify-center items-center w-full py-2.5 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
                  >
                    <Search className="w-4 h-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Search <kbd className="ml-1 text-[10px] opacity-60">⌘K</kbd></p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={openSearch}
                aria-label="Search (⌘K)"
                className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              >
                <Search className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">Search</span>
                <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-sidebar-border bg-sidebar-accent/30 px-1.5 text-[10px] font-medium text-sidebar-foreground/40">
                  ⌘K
                </kbd>
              </button>
            )}

            {allNavItems.map(({ href, label, icon: Icon }) => {
              const isActive =
                location === href ||
                (href !== "/" && location.startsWith(href));
              const item = (
                <Link key={href} href={href}>
                  <div
                    className={[
                      "flex items-center rounded-md transition-colors cursor-pointer text-sm font-medium",
                      collapsed
                        ? "justify-center px-0 py-2.5"
                        : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    ].join(" ")}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : ""}`}
                    />
                    {!collapsed && <span>{label}</span>}
                  </div>
                </Link>
              );
              return collapsed ? (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{label}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                item
              );
            })}

            {/* Divider + external links */}
            <div
              className={`pt-2 mt-2 border-t border-sidebar-border/50 space-y-0.5`}
            >
              {externalNavItems.map(({ href, label, icon: Icon }) => {
                const item = (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div
                      className={[
                        "flex items-center rounded-md transition-colors cursor-pointer text-sm font-medium",
                        collapsed
                          ? "justify-center px-0 py-2.5"
                          : "gap-3 px-3 py-2",
                        "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      ].join(" ")}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </div>
                  </a>
                );
                return collapsed ? (
                  <Tooltip key={href}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{label}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  item
                );
              })}
            </div>

            {/* Saved Views section */}
            <ViewsSection
              collapsed={collapsed}
              userId={user?.id}
              canAdmin={isAdmin}
            />
          </nav>

          {/* Bottom: notifications + theme + user */}
          <div
            className={`border-t border-sidebar-border shrink-0 ${collapsed ? "p-2 space-y-2" : "p-4 space-y-3"}`}
          >
            {/* Notification bell */}
            {collapsed ? (
              <Tooltip>
                <div className="flex justify-center">
                  <NotificationBell collapsed />
                </div>
                <TooltipContent side="right">
                  <p>Notifications</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Notifications
                </span>
                <NotificationBell />
              </div>
            )}

            {/* Theme toggle */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-sidebar-foreground/70"
                        >
                          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="end">
                        <DropdownMenuItem onClick={() => setTheme("light")}>
                          Light
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("dark")}>
                          Dark
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("system")}>
                          System
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Theme</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Theme
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-sidebar-foreground/70"
                    >
                      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                      Light
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                      Dark
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                      System
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* User */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="w-9 h-9 rounded-full overflow-hidden border border-sidebar-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          {user?.profileImageUrl ? (
                            <img
                              src={user.profileImageUrl}
                              alt="avatar"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-primary">
                              {user?.firstName?.[0] ?? user?.email?.[0] ?? "?"}
                            </div>
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="end">
                        <DropdownMenuItem onClick={logout}>
                          <LogOut className="w-4 h-4 mr-2" />
                          Log out
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>
                    {user?.firstName
                      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
                      : (user?.email ?? "User")}
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground/70">
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border border-sidebar-border object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border text-xs font-bold text-primary shrink-0">
                    {user?.firstName?.[0] ?? user?.email?.[0] ?? "?"}
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-sidebar-foreground truncate text-sm">
                    {user?.firstName
                      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
                      : (user?.email ?? "User")}
                  </span>
                  <span className="text-xs opacity-60 truncate">
                    {user?.email ?? ""}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-sidebar-foreground/50 hover:text-sidebar-foreground shrink-0"
                  onClick={logout}
                  title="Log out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        {/* On desktop: takes remaining width, scrolls independently of sidebar */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-4 md:p-8 min-h-full">{children}</div>
        </main>

        {/* Mobile overlay backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[9] md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
