import { useState } from "react";
import { Plus, StickyNote, Trash2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { MarkdownPreview } from "./markdown-preview";
import {
  useListNotes,
  useCreateNote,
  useDeleteNote,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface InlineNotesProps {
  projectId?: number;
  taskId?: number;
}

export function InlineNotes({ projectId, taskId }: InlineNotesProps) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newContent, setNewContent] = useState("");

  const query =
    projectId !== undefined
      ? { projectId }
      : taskId !== undefined
      ? { taskId }
      : {};

  const { data: notes = [], refetch } = useListNotes(query);
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const handleCreate = async () => {
    if (!newContent.trim()) {
      toast({ title: "Note is empty", variant: "destructive" });
      return;
    }
    await createNote.mutateAsync({
      data: {
        title: "Note",
        content: newContent.trim(),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(taskId !== undefined ? { taskId } : {}),
      },
    });
    setIsCreating(false);
    setNewContent("");
    refetch();
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    await deleteNote.mutateAsync({ id: deleteTarget });
    if (expandedId === deleteTarget) setExpandedId(null);
    setDeleteTarget(null);
    refetch();
    toast({ title: "Note deleted" });
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StickyNote className="w-4 h-4 text-primary" />
          Notes
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded">
              {notes.length}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => { setIsCreating(true); setExpandedId(null); }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add note
        </Button>
      </div>

      {/* New-note composer */}
      {isCreating && (
        <div className="border border-primary/40 rounded-md p-3 bg-card space-y-3">
          <Textarea
            autoFocus
            placeholder="Write a note using Markdown…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="min-h-[100px] text-sm resize-none"
          />
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => { setIsCreating(false); setNewContent(""); }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleCreate}
              disabled={createNote.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {notes.length === 0 && !isCreating && (
        <p className="text-xs text-muted-foreground py-2">No notes yet.</p>
      )}

      {/* Note list */}
      {[...notes]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((note) => {
          const isExpanded = expandedId === note.id;
          const canEdit = note.isOwner || note.visibility === "public_write";
          const scratchPadLabel = canEdit ? "Edit in Scratch Pad" : "View in Scratch Pad";
          const footerLabel = canEdit
            ? "Edit full note in Scratch Pad"
            : "View full note in Scratch Pad";

          return (
            <div key={note.id} className="border border-border rounded-md overflow-hidden bg-card">
              {/* Header row */}
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setExpandedId((prev) => (prev === note.id ? null : note.id))}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">
                    {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {note.isOwner && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(note.id); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {isExpanded
                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  }
                </div>
              </div>

              {/* Body - read-only rendered preview with height clamp */}
              {isExpanded && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  {/* Clamped preview container with gradient fade */}
                  <div
                    className="relative max-h-48 overflow-hidden"
                    data-testid="note-preview-clamp"
                  >
                    <MarkdownPreview
                      content={note.content || ""}
                      className="text-sm"
                    />
                    {/* Gradient fade at the bottom */}
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-card to-transparent" />
                  </div>

                  {/* Footer link — shown for all visibility levels */}
                  <Link
                    href={`/notes?note=${note.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
                      <ExternalLink className="w-3 h-3" />
                      {footerLabel}
                    </span>
                  </Link>
                </div>
              )}
            </div>
          );
        })}

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This note will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
