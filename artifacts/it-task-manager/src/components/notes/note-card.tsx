import { formatDistanceToNow } from "date-fns";
import { FileText, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NoteCardProps {
  note: {
    id: number;
    title: string;
    content: string;
    projectId?: number | null;
    taskId?: number | null;
    updatedAt: string;
  };
  isSelected?: boolean;
  projectName?: string | null | undefined;
  taskTitle?: string | null | undefined;
  onClick: () => void;
  onDelete: () => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function NoteCard({ note, isSelected, projectName, taskTitle, onClick, onDelete }: NoteCardProps) {
  const preview = stripHtml(note.content).slice(0, 120) || "No content yet";
  const linkedTo = taskTitle ?? projectName;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-1.5 px-4 py-3 cursor-pointer border-b border-border transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <span className="font-medium text-sm truncate">{note.title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 pl-5">{preview}</p>
      <div className="flex items-center gap-2 pl-5">
        <span className="text-xs text-muted-foreground/60">
          {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
        </span>
        {linkedTo && (
          <>
            <span className="text-xs text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1 text-xs text-primary/70">
              <Link2 className="w-3 h-3" />
              {linkedTo}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
