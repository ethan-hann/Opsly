import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { formatDate, cn } from "@/lib/utils";

// ─── Shared ghost-trigger class (matches inline-editing triggers in detail panes) ─

export const GHOST_TRIGGER = [
  "h-8 w-full flex items-center gap-2 rounded-md -ml-2 px-2",
  "border border-transparent hover:border-border",
  "bg-transparent hover:bg-background",
  "text-sm font-medium text-left transition-colors",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
].join(" ");

// ─── Property row wrapper ─────────────────────────────────────────────────────

export function PropertyRow({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Inline due-date picker ───────────────────────────────────────────────────

export function InlineDueDatePicker({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChange: (date: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  // Parse YYYY-MM-DD as local date to avoid UTC-offset day shifts
  const selected = value
    ? (() => {
        const [y, m, d] = value.split("-").map(Number);
        return new Date(y, m - 1, d);
      })()
    : undefined;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={GHOST_TRIGGER}>
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className={cn(!value && "text-muted-foreground italic")}>
            {value ? formatDate(value, i18n.language) : t("taskDetail.noDueDate")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              const y = date.getFullYear();
              const mo = String(date.getMonth() + 1).padStart(2, "0");
              const dy = String(date.getDate()).padStart(2, "0");
              onChange(`${y}-${mo}-${dy}`);
            }
            onOpenChange(false);
          }}
        />
        {value && (
          <div className="border-t border-border p-2">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1 rounded transition-colors"
              onClick={() => {
                onChange(null);
                onOpenChange(false);
              }}
            >
              <X className="w-3.5 h-3.5" /> {t("taskDetail.clearDueDate")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
