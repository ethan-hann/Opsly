import { useState, useRef, useCallback } from "react";
import { Plus, StickyNote, Trash2, ChevronDown, ChevronUp, CheckCheck } from "lucide-react";
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
  const [originalContent, setOriginalContent] = useState<string>("");
  const [savedIndicatorId, setSavedIndicatorId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newContent, setNewContent] = useState("");

  // When any navigation would lose a dirty edit, we store the intended action
  // here and show the confirmation dialog. Cleared on dialog close.
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query =
    projectId !== undefined
      ? { projectId }
      : taskId !== undefined
      ? { taskId }
      : {};

  const { data: notes = [], refetch } = useListNotes(query);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const isDirty = editingId !== null && draftContent !== originalContent;

  // ─── helpers ────────────────────────────────────────────────────────────────

  const flashSaved = (id: number) => {
    setSavedIndicatorId(id);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(
      () => setSavedIndicatorId((prev) => (prev === id ? null : prev)),
      2000,
    );
  };

  const doSave = useCallback(
    async (id: number, content: string) => {
      await updateNote.mutateAsync({ id, data: { content } });
      setOriginalContent(content);
      flashSaved(id);
      refetch();
    },
    [updateNote, refetch],
  );

  /** Clear all edit state cleanly (call AFTER save or discard decision). */
  const exitEdit = useCallback(() => {
    setEditingId(null);
    setDraftContent("");
    setOriginalContent("");
  }, []);

  /**
   * Central guard for every action that could navigate away from a dirty edit.
   *
   * • If no dirty edit is active → run the action immediately (exits edit
   *   cleanly first if there's a non-dirty session open).
   * • If dirty → store the action and open the confirmation dialog.
   */
  const attemptAction = useCallback(
    (action: () => void) => {
      if (isDirty) {
        setPendingAction(() => action);
      } else {
        if (editingId !== null) exitEdit();
        action();
      }
    },
    [isDirty, editingId, exitEdit],
  );

  // ─── dialog handlers ─────────────────────────────────────────────────────────

  const handleKeepEditing = () => setPendingAction(null);

  const handleDiscard = () => {
    const action = pendingAction;
    setPendingAction(null);
    exitEdit();
    action?.();
  };

  const handleSaveAndClose = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (editingId !== null) await doSave(editingId, draftContent);
    exitEdit();
    action?.();
  };

  // ─── note actions ─────────────────────────────────────────────────────────

  /** Clicking a note's header row — toggle expand/collapse, guard dirty edits. */
  const handleHeaderClick = (noteId: number) => {
    attemptAction(() => {
      setExpandedId((prev) => (prev === noteId ? null : noteId));
    });
  };

  /** Entering edit mode for a specific note — guard any active dirty edit first. */
  const handleStartEdit = (noteId: number, content: string) => {
    attemptAction(() => {
      setEditingId(noteId);
      setDraftContent(content);
      setOriginalContent(content);
    });
  };

  /** "Add note" button — guard dirty edits before opening the composer. */
  const handleAddNote = () => {
    attemptAction(() => {
      setIsCreating(true);
      setExpandedId(null);
    });
  };

  /** Explicit Save button inside the editor. */
  const handleSave = async () => {
    if (editingId === null) return;
    await doSave(editingId, draftContent);
  };

  /** "Close" button inside the editor. */
  const handleClose = () => {
    attemptAction(() => {
      /* exitEdit is called inside attemptAction when not dirty */
    });
    // When NOT dirty, attemptAction already calls exitEdit and then the no-op
    // lambda. When dirty, the dialog opens. Either way this is correct.
  };

  /** Auto-save on editor blur — no timer, immediate, so there's no race with button clicks. */
  const handleEditorBlur = useCallback(() => {
    if (editingId === null || !isDirty) return;
    doSave(editingId, draftContent);
  }, [editingId, isDirty, draftContent, doSave]);

  // ─── create / delete ─────────────────────────────────────────────────────

  const handleCreate = async () => {
    const isEmpty =
      !newContent ||
      newContent === "<p></p>" ||
      !newContent.replace(/<[^>]*>/g, "").trim();
    if (isEmpty) {
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

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    await deleteNote.mutateAsync({ id: deleteTarget });
    if (editingId === deleteTarget) exitEdit();
    if (expandedId === deleteTarget) setExpandedId(null);
    setDeleteTarget(null);
    refetch();
    toast({ title: "Note deleted" });
  };

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Header */}
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
          onClick={handleAddNote}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add note
        </Button>
      </div>

      {/* New-note composer */}
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
              onClick={() => {
                setIsCreating(false);
                setNewContent("");
              }}
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
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .map((note) => {
          const isExpanded = expandedId === note.id;
          const isEditing = editingId === note.id;
          const justSaved = savedIndicatorId === note.id;

          return (
            <div
              key={note.id}
              className="border border-border rounded-md overflow-hidden bg-card"
            >
              {/* Header row */}
              <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => handleHeaderClick(note.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">
                    {formatDistanceToNow(new Date(note.updatedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(note.id);
                    }}
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

              {/* Body */}
              {isExpanded && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  {isEditing ? (
                    <>
                      <RichTextEditor
                        content={draftContent}
                        onChange={setDraftContent}
                        onBlur={handleEditorBlur}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs flex items-center gap-1 transition-opacity duration-500 ${
                            justSaved
                              ? "text-primary opacity-100"
                              : "opacity-0 pointer-events-none"
                          }`}
                        >
                          <CheckCheck className="w-3 h-3" />
                          Saved
                        </span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={handleClose}
                          >
                            Close
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={handleSave}
                            disabled={updateNote.isPending || !isDirty}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none text-sm"
                        dangerouslySetInnerHTML={{
                          __html:
                            note.content ||
                            "<p class='text-muted-foreground'>Empty note.</p>",
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => handleStartEdit(note.id, note.content)}
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

      {/* ── Unsaved-changes confirmation ────────────────────────────────── */}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) handleKeepEditing();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this note. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleKeepEditing}>
              Keep editing
            </AlertDialogCancel>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDiscard}
            >
              Discard
            </Button>
            <AlertDialogAction onClick={handleSaveAndClose}>
              Save &amp; continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirmation ─────────────────────────────────────────── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
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
