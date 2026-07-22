/**
 * ReferencePicker — floating picker popup for / reference insertion.
 *
 * Mirrors the MentionPicker pattern. Rendered via a React portal at
 * document.body so overflow-hidden wrappers do not clip it.
 *
 * Shows a three-tab filter bar (All / Tasks / Projects) and a scrollable,
 * keyboard-navigable list of results. The popup opens above or below the
 * caret based on the `showBelow` flag in the PickerRect it receives.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useGetReferences } from "@workspace/api-client-react";
import { useTerminology } from "@/context/terminology-context";
import type { PickerRect } from "./picker-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefType = "all" | "task" | "project";

interface ReferencePickerProps {
  query: string;
  filterType: RefType;
  selectedIdx: number;
  pickerRect: PickerRect;
  onSelect: (token: string) => void;
  onClose: () => void;
  onFilterChange: (type: RefType) => void;
  onSelectedIdxChange: (idx: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface ReferenceItem {
  token: string;
  label: string;
  sub?: string;
}

export function buildReferenceItems(
  tasks: Array<{ id: number; title: string; projectName?: string | null }>,
  projects: Array<{ id: number; name: string }>,
): ReferenceItem[] {
  return [
    ...tasks.map((t) => ({
      token: `#[task:${t.id}:${t.title}]`,
      label: t.title,
      sub: t.projectName ?? undefined,
    })),
    ...projects.map((p) => ({
      token: `#[project:${p.id}:${p.name}]`,
      label: p.name,
    })),
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReferencePicker({
  query,
  filterType,
  selectedIdx,
  pickerRect,
  onSelect,
  onFilterChange,
  onSelectedIdxChange,
}: ReferencePickerProps) {
  const { ts } = useTerminology();

  const { data, isLoading } = useGetReferences(
    { q: query || undefined, type: filterType, limit: 20 },
    {
      query: {
        staleTime: 5_000,
        queryKey: ["getReferences", filterType, query],
      },
    },
  );

  const items = buildReferenceItems(data?.tasks ?? [], data?.projects ?? []);

  // Scroll the selected item into view.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLElement>("[data-selected='true']");
    if (selected && typeof selected.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  const tabs: Array<{ id: RefType; label: string }> = [
    { id: "all", label: "All" },
    { id: "task", label: ts("tasks") },
    { id: "project", label: ts("projects") },
  ];

  return createPortal(
    <div
      data-testid="reference-picker"
      style={{
        position: "fixed",
        top: pickerRect.top,
        left: pickerRect.left,
        width: Math.min(pickerRect.width, 360),
        // Flip above caret when there is not enough space below.
        transform: pickerRect.showBelow
          ? "none"
          : "translateY(-100%) translateY(-4px)",
        zIndex: 9999,
        // Radix Dialog sets `document.body { pointer-events: none }` in modal
        // mode; this re-enables pointer events for our portal-rendered picker.
        pointerEvents: "auto",
      }}
      className="rounded-md border border-border bg-popover shadow-lg overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Filter tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`ref-tab-${tab.id}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onFilterChange(tab.id);
              onSelectedIdxChange(0);
            }}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
              filterType === tab.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results list */}
      <div ref={listRef} className="max-h-48 overflow-auto">
        {isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground animate-pulse">
            Searching…
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No results
          </div>
        ) : (
          items.map((item, idx) => (
            <button
              key={item.token}
              type="button"
              data-testid={`ref-item-${idx}`}
              data-selected={idx === selectedIdx ? "true" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item.token);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                idx === selectedIdx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="font-medium truncate">{item.label}</span>
              {item.sub && (
                <span className="text-xs text-muted-foreground truncate shrink-0">
                  {item.sub}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
