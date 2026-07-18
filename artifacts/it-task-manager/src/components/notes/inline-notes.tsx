import { useState } from "react";
import { Plus, StickyNote, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { RichTextEditor } from "./rich-text-editor";
import {
  useListNotes,
  useCreateNote,
  useUpdateNote,
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newContent, setNewContent] = useState("");

  const query = projectId !== undefined
    ? { projectId }
    : taskId !== undefined
    ? { taskId }
    : {};

  const { data: notes = [], refetch } = useListNotes(query);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const handleCreate = async () => {
    if (!newContent.trim() && newContent !== "<p></p>") {
      toast({ title: "Note is empty", variant: "destructive" });
      return;
    }
    await createNote.mutateAsync({
      data: {
        title: "Note",
        content: newContent,
        ...(projectId !== undefined ? { projectId } : {}),
        ...(taskId !== undefined ? { taskId } : {}),
      },
    });
    setIsCreating(false);
    setNewContent("");
    refetch();
  };

  const handleSave = async () => {
    if (editingId === null) return;
    await updateNote.mutateAsync({
      id: editingId,
      data: { content: draftContent },
    });
    setEditingId(null);
    refetch();
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    await deleteNote.mutateAsync({ id: deleteTarget });
    if (editingId === deleteTarget) setEditingId(null);
    if (expandedId === deleteTarget) setExpandedId(null);
    setDeleteTarget(null);
    refetch();
    toast({ title: "Note deleted" });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StickyNote className="w-4 h-4 text-primary" />
          Notes
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground font-mono bg-accent px-1.5 py-0.5 rounded">
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

      {/* New note composer */}
      {isCreating && (
        <div className="border border-primary/40 rounded-md p-3 bg-card space-y-3">
          <RichTextEditor
            content=""
            onChange={setNewContent}
            placeholder="Write a note…"
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

      {/* Existing notes */}
      {notes.length === 0 && !isCreating && (
        <p className="text-xs text-muted-foreground py-2">No notes yet.</p>
      )}

      {[...notes]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((note) => {
          const isExpanded = expandedId === note.id;
          const isEditing = editingId === note.id;

          return (
            <div
              key={note.id}
              className="border border-border rounded-md overflow-hidden bg-card"
            >
              {/* Note header row */}
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : note.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">
                    {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(note.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  {isEditing ? (
                    <>
                      <RichTextEditor
                        content={draftContent}
                        onChange={setDraftContent}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleSave}
                          disabled={updateNote.isPending}
                        >
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none text-sm"
                        dangerouslySetInnerHTML={{ __html: note.content || "<p class='text-muted-foreground'>Empty note.</p>" }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => { setEditingId(note.id); setDraftContent(note.content); }}
                      >
                        Edit
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
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
