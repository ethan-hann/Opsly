import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ScrollNavigationButtonsProps {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

export function ScrollNavigationButtons({
  scrollContainerRef,
}: ScrollNavigationButtonsProps) {
  const { t } = useTranslation();
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    function update() {
      const { scrollTop, scrollHeight, clientHeight } = el!;
      setShowTop(scrollTop > 200);
      setShowBottom(scrollHeight - scrollTop - clientHeight > 200);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    // Re-evaluate when content height changes (e.g. data loads in)
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollContainerRef]);

  const scrollTo = (position: "top" | "bottom") => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: position === "top" ? 0 : el.scrollHeight,
      behavior: "smooth",
    });
  };

  // Don't render the wrapper at all when both are hidden to avoid stray z-index
  if (!showTop && !showBottom) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => scrollTo("top")}
            aria-label={t("common.scrollToTop")}
            className={cn(
              "h-9 w-9 rounded-full border border-border bg-background shadow-md",
              "flex items-center justify-center text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "transition-opacity duration-200",
              showTop ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{t("common.scrollToTop")}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => scrollTo("bottom")}
            aria-label={t("common.scrollToBottom")}
            className={cn(
              "h-9 w-9 rounded-full border border-border bg-background shadow-md",
              "flex items-center justify-center text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "transition-opacity duration-200",
              showBottom ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{t("common.scrollToBottom")}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
