import { useState, useCallback, useRef } from "react";
import { Plus, StickyNote, Search, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RichTextEditor } from "@/components/notes/rich-text-editor";
import { NoteCard } from "@/components/notes/note-card";
import {
  useListNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from "@workspace/api-client-react";
import { useListProjects, useListTasks } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export default function NotesPage() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const { data: notes = [], refetch } = useListNotes({});
  const { data: projects = [] } = useListProjects();
  const { data: tasks = [] } = useListTasks({});

  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  // Auto-save debounce
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  const filteredNotes = notes.filter((n) => {
    const q = search.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q)
    );
  });

  const handleNew = async () => {
    const result = await createNote.mutateAsync({
      data: { title: "Untitled Note", content: "" },
    });
    setSelectedId(result.id);
    refetch();
  };

  const scheduleAutoSave = useCallback(
    (id: number, patch: { title?: string; content?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await updateNote.mutateAsync({ id, data: patch });
        refetch();
      }, 800);
    },
    [updateNote, refetch],
  );

  const handleTitleChange = (val: string) => {
    if (!selectedNote) return;
    scheduleAutoSave(selectedNote.id, { title: val || "Untitled Note" });
  };

  const handleContentChange = (html: string) => {
    if (!selectedNote) return;
    scheduleAutoSave(selectedNote.id, { content: html });
  };

  const handleLinkChange = async (
    field: "projectId" | "taskId",
    value: string,
  ) => {
    if (!selectedNote) return;
    const numVal = value === "none" ? null : Number(value);
    await updateNote.mutateAsync({
      id: selectedNote.id,
      data: { [field]: numVal },
    });
    refetch();
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    await deleteNote.mutateAsync({ id: deleteTarget });
    if (selectedId === deleteTarget) setSelectedId(null);
    setDeleteTarget(null);
    refetch();
    toast({ title: "Note deleted" });
  };

  const getProjectName = (id: number | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? null : null;

  const getTaskTitle = (id: number | null) =>
    id ? tasks.find((t) => t.id === id)?.title ?? null : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-[calc(100dvh-2rem)] -m-4 md:-m-8 overflow-hidden rounded-lg border border-border">
      {/* Sidebar: note list */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card">
        <div className="p-3 border-b border-border flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm flex-1">Scratch Pad</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={handleNew}
            disabled={createNote.isPending}
            title="New note"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-7 text-xs bg-background"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <StickyNote className="w-8 h-8 opacity-30" />
              <p className="text-xs">
                {search ? "No matches" : "No notes yet"}
              </p>
              {!search && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={handleNew}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  New note
                </Button>
              )}
            </div>
          ) : (
            [...filteredNotes]
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
              )
              .map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  isSelected={note.id === selectedId}
                  projectName={getProjectName(note.projectId ?? null)}
                  taskTitle={getTaskTitle(note.taskId ?? null)}
                  onClick={() => setSelectedId(note.id)}
                  onDelete={() => setDeleteTarget(note.id)}
                />
              ))
          )}
        </div>
      </div>

      {/* Editor pane */}
      {selectedNote ? (
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Note header */}
          <div className="px-6 pt-5 pb-3 border-b border-border">
            <input
              key={selectedNote.id}
              defaultValue={selectedNote.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full bg-transparent text-xl font-semibold focus:outline-none placeholder:text-muted-foreground"
              placeholder="Untitled Note"
            />
            {/* Link controls */}
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Project:</span>
                <Select
                  value={selectedNote.projectId?.toString() ?? "none"}
                  onValueChange={(v) => handleLinkChange("projectId", v)}
                >
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Link2Off className="w-3 h-3" /> None
                      </span>
                    </SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Task:</span>
                <Select
                  value={selectedNote.taskId?.toString() ?? "none"}
                  onValueChange={(v) => handleLinkChange("taskId", v)}
                >
                  <SelectTrigger className="h-7 text-xs w-52">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Link2Off className="w-3 h-3" /> None
                      </span>
                    </SelectItem>
                    {tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        <span className="truncate max-w-[180px] block">{t.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Rich text body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <RichTextEditor
              key={selectedNote.id}
              content={selectedNote.content}
              onChange={handleContentChange}
              placeholder="Start writing… use the toolbar above to format your note."
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground bg-background">
          <StickyNote className="w-12 h-12 opacity-20" />
          <p className="text-sm">Select a note or create one</p>
          <Button variant="outline" size="sm" onClick={handleNew}>
            <Plus className="w-4 h-4 mr-1" />
            New note
          </Button>
        </div>
      )}

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
