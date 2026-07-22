/**
 * MentionPicker — floating @mention autocomplete popup.
 *
 * Rendered into document.body via a React portal so overflow-hidden wrappers
 * on the editor cannot clip it.  Mirrors the ReferencePicker layout and
 * positioning logic for a uniform autocomplete experience across both pickers.
 */

import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { PickerRect } from "./picker-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MentionItem {
  token: string;
  label: string;
  sub?: string;
}

interface MentionPickerProps {
  items: MentionItem[];
  selectedIdx: number;
  pickerRect: PickerRect;
  onSelect: (token: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MentionPicker({
  items,
  selectedIdx,
  pickerRect,
  onSelect,
}: MentionPickerProps) {
  if (items.length === 0) return null;

  return createPortal(
    <div
      data-testid="mention-picker"
      style={{
        position: "fixed",
        top: pickerRect.top,
        left: pickerRect.left,
        width: Math.min(pickerRect.width, 320),
        transform: pickerRect.showBelow
          ? "none"
          : "translateY(-100%) translateY(-4px)",
        zIndex: 9999,
        // Radix Dialog sets `document.body { pointer-events: none }` in modal
        // mode; this re-enables pointer events for our portal-rendered picker.
        pointerEvents: "auto",
      }}
      className="max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => (
        <button
          key={item.token}
          type="button"
          data-testid={`mention-item-${idx}`}
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
          <span
            className={cn(
              "font-medium",
              item.label.startsWith("@") && "text-primary",
            )}
          >
            {item.label}
          </span>
          {item.sub && (
            <span className="text-xs text-muted-foreground truncate">
              {item.sub}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
