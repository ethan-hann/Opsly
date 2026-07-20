import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { CheckSquare, FolderGit2, StickyNote, Search, ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { useGlobalSearch as useSearchQuery } from "@workspace/api-client-react";

// ─── Debounce hook ────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Result row ───────────────────────────────────────────────────────────────

interface ResultRowProps {
  icon: React.ReactNode;
  primary: string;
  secondary?: string | null;
  isActive: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}

function ResultRow({ icon, primary, secondary, isActive, onSelect, onMouseEnter }: ResultRowProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isActive]);

  return (
    <button
      ref={ref}
      role="option"
      aria-selected={isActive}
      className={[
        "flex items-start gap-3 w-full px-3 py-2 text-left rounded-md transition-colors text-sm",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-accent/50",
      ].join(" ")}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="font-medium truncate block">{primary}</span>
        {secondary && (
          <span className="text-xs text-muted-foreground truncate block">{secondary}</span>
        )}
      </span>
    </button>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return (
    <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </p>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface FlatResult {
  key: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string | null;
  href: string;
}

export function GlobalSearchPalette() {
  const { isOpen, close } = useGlobalSearch();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 200);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const { data, isFetching } = useSearchQuery(
    { q: debouncedQuery, limit: 5 },
    {
      query: {
        enabled: debouncedQuery.length >= 1,
        staleTime: 10_000,
        queryKey: ["globalSearch", debouncedQuery],
      },
    }
  );

  // Build flat list for keyboard navigation
  const flatResults: FlatResult[] = [];

  if (data) {
    for (const t of data.tasks) {
      flatResults.push({
        key: `task-${t.id}`,
        icon: <CheckSquare className="w-4 h-4" />,
        primary: t.title,
        secondary: [t.status, t.priority].filter(Boolean).join(" · "),
        href: `/tasks/${t.id}?from=search`,
      });
    }
    for (const p of data.projects) {
      flatResults.push({
        key: `project-${p.id}`,
        icon: <FolderGit2 className="w-4 h-4" />,
        primary: p.name,
        secondary: p.status,
        href: `/projects/${p.id}?from=search`,
      });
    }
    for (const n of data.notes) {
      flatResults.push({
        key: `note-${n.id}`,
        icon: <StickyNote className="w-4 h-4" />,
        primary: n.title,
        secondary: n.excerpt ?? undefined,
        href: `/notes`,
      });
    }
  }

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, data]);

  const goTo = useCallback(
    (href: string) => {
      close();
      navigate(href);
    },
    [close, navigate]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatResults[activeIndex]) {
        goTo(flatResults[activeIndex].href);
      }
    } else if (e.key === "Escape") {
      close();
    }
  };

  const hasResults = flatResults.length > 0;
  const isEmpty = debouncedQuery.length >= 1 && !isFetching && !hasResults;
  const taskCount = data?.tasks.length ?? 0;
  const projectCount = data?.projects.length ?? 0;
  const noteCount = data?.notes.length ?? 0;

  // Build grouped view for rendering
  let flatIdx = 0;
  const taskStartIdx = 0;
  const projectStartIdx = taskCount;
  const noteStartIdx = taskCount + projectCount;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="p-0 gap-0 max-w-xl overflow-hidden"
        aria-label="Global search"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          {isFetching ? (
            <Loader2 className="w-4 h-4 shrink-0 text-muted-foreground animate-spin" />
          ) : (
            <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="search-listbox"
            aria-activedescendant={
              flatResults[activeIndex] ? `sr-${flatResults[activeIndex].key}` : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, notes…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          id="search-listbox"
          role="listbox"
          aria-label="Search results"
          className="max-h-[min(70vh,480px)] overflow-y-auto p-2"
        >
          {/* Empty prompt */}
          {debouncedQuery.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Type to search across tasks, projects &amp; notes
            </p>
          )}

          {/* Loading skeleton */}
          {isFetching && debouncedQuery.length >= 1 && (
            <div className="space-y-1.5 p-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 rounded-md bg-muted/50 animate-pulse" />
              ))}
            </div>
          )}

          {/* No results */}
          {isEmpty && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No results for &ldquo;{debouncedQuery}&rdquo;
            </p>
          )}

          {/* Tasks section */}
          {!isFetching && taskCount > 0 && (
            <div role="group" aria-label="Tasks">
              <SectionHeading label="Tasks" />
              {data!.tasks.map((t, i) => {
                const idx = taskStartIdx + i;
                return (
                  <ResultRow
                    key={`task-${t.id}`}
                    icon={<CheckSquare className="w-4 h-4" />}
                    primary={t.title}
                    secondary={[t.status, t.priority].filter(Boolean).join(" · ")}
                    isActive={activeIndex === idx}
                    onSelect={() => goTo(`/tasks/${t.id}?from=search`)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  />
                );
              })}
              {/* View all tasks link */}
              <a
                href={`/tasks?search=${encodeURIComponent(debouncedQuery)}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(`/tasks?search=${encodeURIComponent(debouncedQuery)}`);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:underline"
              >
                <ArrowRight className="w-3 h-3" />
                View all results for &ldquo;{debouncedQuery}&rdquo; in Tasks
              </a>
            </div>
          )}

          {/* Projects section */}
          {!isFetching && projectCount > 0 && (
            <div role="group" aria-label="Projects">
              <SectionHeading label="Projects" />
              {data!.projects.map((p, i) => {
                const idx = projectStartIdx + i;
                return (
                  <ResultRow
                    key={`project-${p.id}`}
                    icon={<FolderGit2 className="w-4 h-4" />}
                    primary={p.name}
                    secondary={p.status}
                    isActive={activeIndex === idx}
                    onSelect={() => goTo(`/projects/${p.id}?from=search`)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  />
                );
              })}
              <a
                href={`/projects?search=${encodeURIComponent(debouncedQuery)}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(`/projects?search=${encodeURIComponent(debouncedQuery)}`);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:underline"
              >
                <ArrowRight className="w-3 h-3" />
                View all results for &ldquo;{debouncedQuery}&rdquo; in Projects
              </a>
            </div>
          )}

          {/* Notes section */}
          {!isFetching && noteCount > 0 && (
            <div role="group" aria-label="Notes">
              <SectionHeading label="Notes" />
              {data!.notes.map((n, i) => {
                const idx = noteStartIdx + i;
                return (
                  <ResultRow
                    key={`note-${n.id}`}
                    icon={<StickyNote className="w-4 h-4" />}
                    primary={n.title}
                    secondary={n.excerpt ?? undefined}
                    isActive={activeIndex === idx}
                    onSelect={() => goTo(`/notes?note=${n.id}`)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  />
                );
              })}
              <a
                href={`/notes?search=${encodeURIComponent(debouncedQuery)}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(`/notes?search=${encodeURIComponent(debouncedQuery)}`);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary hover:underline"
              >
                <ArrowRight className="w-3 h-3" />
                View all results for &ldquo;{debouncedQuery}&rdquo; in Notes
              </a>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground bg-muted/30">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-background px-1">↑</kbd>
            <kbd className="rounded border border-border bg-background px-1">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-background px-1">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-background px-1">Esc</kbd>
            close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
