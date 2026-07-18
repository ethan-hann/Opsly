import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, CheckSquare, FolderGit2, StickyNote,
  Menu, Moon, Sun, Activity, LogOut, Settings,
  PanelLeftClose, PanelLeftOpen, BookOpen,
} from "lucide-react";
import { useTheme } from "../theme-provider";
import { useAuth } from "@workspace/replit-auth-web";
import { useOrgContext } from "@/hooks/use-org-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState, useEffect } from "react";

const mainNavItems = [
  { href: "/",        label: "Dashboard",  icon: LayoutDashboard },
  { href: "/tasks",   label: "Tasks",      icon: CheckSquare },
  { href: "/projects",label: "Projects",   icon: FolderGit2 },
  { href: "/notes",   label: "Scratch Pad",icon: StickyNote },
];

const externalNavItems = [
  { href: "/api/docs", label: "API Docs", icon: BookOpen },
];

function readCollapsed() {
  try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
}
function writeCollapsed(v: boolean) {
  try { localStorage.setItem("sidebar-collapsed", String(v)); } catch { /* ignore */ }
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { isAdmin, org } = useOrgContext();

  // Mobile: drawer open/closed
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: collapsed (icon rail) vs expanded
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // Close mobile drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [location]);

  const toggleCollapse = () =>
    setCollapsed((prev) => { const next = !prev; writeCollapsed(next); return next; });

  const allNavItems = [
    ...mainNavItems,
    ...(isAdmin ? [{ href: "/org/settings", label: "Org Settings", icon: Settings }] : []),
  ];

  return (
    <TooltipProvider delayDuration={300}>
      {/* Root — full height on desktop, natural height on mobile */}
      <div className="flex flex-col md:flex-row md:h-[100dvh] min-h-[100dvh] bg-background text-foreground font-sans">

        {/* ── Mobile top bar ─────────────────────────────────────────────── */}
        <header className="md:hidden shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card z-20">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-primary-foreground shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-semibold tracking-tight truncate">Mission Control</span>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMobileOpen(!mobileOpen)}>
            <Menu className="w-5 h-5" />
          </Button>
        </header>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={[
            // base
            "fixed md:relative md:sticky top-0 left-0 z-10 h-[100dvh]",
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
          <div className={`hidden md:flex items-center border-b border-sidebar-border shrink-0 h-[61px] ${collapsed ? "justify-center px-2" : "px-5 gap-3"}`}>
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-sm shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="font-bold tracking-tight leading-tight">Mission Control</p>
                  {org && <p className="text-xs text-sidebar-foreground/50 truncate">{org.name}</p>}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 shrink-0 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                      onClick={toggleCollapse}
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>Collapse sidebar</p></TooltipContent>
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
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                    onClick={toggleCollapse}
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>Expand sidebar</p></TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Nav */}
          <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}>
            {allNavItems.map(({ href, label, icon: Icon }) => {
              const isActive = location === href || (href !== "/" && location.startsWith(href));
              const item = (
                <Link key={href} href={href}>
                  <div className={[
                    "flex items-center rounded-md transition-colors cursor-pointer text-sm font-medium",
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  ].join(" ")}>
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                    {!collapsed && <span>{label}</span>}
                  </div>
                </Link>
              );
              return collapsed ? (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="right"><p>{label}</p></TooltipContent>
                </Tooltip>
              ) : item;
            })}

            {/* Divider + external links */}
            <div className={`pt-2 mt-2 border-t border-sidebar-border/50 space-y-0.5`}>
              {externalNavItems.map(({ href, label, icon: Icon }) => {
                const item = (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                    <div className={[
                      "flex items-center rounded-md transition-colors cursor-pointer text-sm font-medium",
                      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                      "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    ].join(" ")}>
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </div>
                  </a>
                );
                return collapsed ? (
                  <Tooltip key={href}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent side="right"><p>{label}</p></TooltipContent>
                  </Tooltip>
                ) : item;
              })}
            </div>
          </nav>

          {/* Bottom: theme + user */}
          <div className={`border-t border-sidebar-border shrink-0 ${collapsed ? "p-2 space-y-2" : "p-4 space-y-3"}`}>
            {/* Theme toggle */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-sidebar-foreground/70">
                          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="end">
                        <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right"><p>Theme</p></TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Theme</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/70">
                      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
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
                          {user?.profileImageUrl
                            ? <img src={user.profileImageUrl} alt="avatar" className="w-full h-full object-cover" />
                            : <div className="w-full h-full bg-sidebar-accent flex items-center justify-center font-mono text-xs font-bold text-primary">
                                {user?.firstName?.[0] ?? user?.email?.[0] ?? "?"}
                              </div>
                          }
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="end">
                        <DropdownMenuItem onClick={logout}>
                          <LogOut className="w-4 h-4 mr-2" />Log out
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.email ?? "User"}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground/70">
                {user?.profileImageUrl
                  ? <img src={user.profileImageUrl} alt="avatar" className="w-8 h-8 rounded-full border border-sidebar-border object-cover shrink-0" />
                  : <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border font-mono text-xs font-bold text-primary shrink-0">
                      {user?.firstName?.[0] ?? user?.email?.[0] ?? "?"}
                    </div>
                }
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-sidebar-foreground truncate text-sm">
                    {user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.email ?? "User"}
                  </span>
                  <span className="text-xs opacity-60 truncate">{user?.email ?? ""}</span>
                </div>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-sidebar-foreground/50 hover:text-sidebar-foreground shrink-0"
                  onClick={logout} title="Log out"
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
          <div className="p-4 md:p-8 min-h-full">
            {children}
          </div>
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
