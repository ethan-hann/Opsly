import { useState, useCallback, useRef, useEffect } from "react";
import { useSearch } from "wouter";
import {
  Plus, StickyNote, Search, Link2Off,
  PanelBottom, PanelRight, ExternalLink, EyeOff, Eye,
  CheckCheck, Lock, Users, ArrowLeft, Edit2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { MarkdownPreview, openPreviewWindow } from "@/components/notes/markdown-preview";
import { NoteCard } from "@/components/notes/note-card";
import {
  useListNotes, useCreateNote, useUpdateNote, useDeleteNote,
  NoteVisibility,
} from "@workspace/api-client-react";
import { useListProjects, useListTasks } from "@workspace/api-client-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  PanelGroup, Panel, PanelResizeHandle,
} from "react-resizable-panels";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

type PreviewDock = "right" | "bottom" | "window" | "hidden";

const VISIBILITY_OPTIONS: { value: NoteVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { value: "private",      label: "Private",       icon: Lock,  description: "Only you can see and edit" },
  { value: "public_read",  label: "Shared (read)", icon: Eye,   description: "Org can view, only you can edit" },
  { value: "public_write", label: "Shared (edit)", icon: Users, description: "Org can view and edit" },
];

export default function NotesPage() {
  const { toast } = useToast();
  // Pre-select a note when navigated here via ?note=<id> (e.g. from "Edit in Scratch Pad")
  const urlSearch = useSearch();
  const noteParam = new URLSearchParams(urlSearch).get("note");
  const preselectedId = noteParam ? parseInt(noteParam, 10) : null;

  const [selectedId, setSelectedId] = useState<number | null>(preselectedId);
  const [search, setSearch] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<number | "all">("all");
  const [filterTaskId, setFilterTaskId] = useState<number | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [dock, setDock] = useState<PreviewDock>("right");
  const [localContent, setLocalContent] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: notes = [], refetch } = useListNotes({});
  const { data: projects = [] } = useListProjects();
  const { data: tasks = [] } = useListTasks({});

  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When navigated here with ?note=<id>, populate localContent once notes load
  const didSyncPreselect = useRef(false);
  useEffect(() => {
    if (!preselectedId || didSyncPreselect.current || notes.length === 0) return;
    const note = notes.find((n) => n.id === preselectedId);
    if (note) {
      setLocalContent(note.content ?? "");
      didSyncPreselect.current = true;
    }
  }, [notes, preselectedId]);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  const filtersActive = filterProjectId !== "all" || filterTaskId !== "all";

  const filteredNotes = [...notes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .filter((n) => {
      const q = search.toLowerCase();
      const matchesSearch = !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
      const matchesProject = filterProjectId === "all" || n.projectId === filterProjectId;
      const matchesTask = filterTaskId === "all" || n.taskId === filterTaskId;
      return matchesSearch && matchesProject && matchesTask;
    });

  const flashSaved = () => {
    setSavedAt(Date.now());
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedAt(null), 2000);
  };

  const scheduleAutoSave = useCallback(
    (id: number, patch: { title?: string; content?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await updateNote.mutateAsync({ id, data: patch });
        flashSaved();
        refetch();
      }, 800);
    },
    [updateNote, refetch],
  );

  const handleNew = async () => {
    const result = await createNote.mutateAsync({
      data: { title: "Untitled Note", content: "" },
    });
    setSelectedId(result.id);
    setLocalContent("");
    refetch();
  };

  const handleSelectNote = (id: number) => {
    const note = notes.find((n) => n.id === id);
    setSelectedId(id);
    setLocalContent(note?.content ?? "");
  };

  const handleBack = () => setSelectedId(null);

  const handleTitleChange = (val: string) => {
    if (!selectedNote) return;
    scheduleAutoSave(selectedNote.id, { title: val || "Untitled Note" });
  };

  const handleContentChange = (md: string) => {
    setLocalContent(md);
    if (!selectedNote) return;
    scheduleAutoSave(selectedNote.id, { content: md });
  };

  const handleLinkChange = async (field: "projectId" | "taskId", value: string) => {
    if (!selectedNote) return;
    const numVal = value === "none" ? null : Number(value);
    await updateNote.mutateAsync({ id: selectedNote.id, data: { [field]: numVal } });
    refetch();
  };

  const handleVisibilityChange = async (visibility: NoteVisibility) => {
    if (!selectedNote) return;
    await updateNote.mutateAsync({ id: selectedNote.id, data: { visibility } });
    flashSaved();
    refetch();
  };

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    await deleteNote.mutateAsync({ id: deleteTarget });
    if (selectedId === deleteTarget) { setSelectedId(null); setLocalContent(""); }
    setDeleteTarget(null);
    refetch();
    toast({ title: "Note deleted" });
  };

  const handleOpenWindow = () => {
    if (!selectedNote) return;
    openPreviewWindow(selectedNote.title, localContent || selectedNote.content);
  };

  const getProjectName = (id: number | null | undefined) =>
    id ? projects.find((p) => p.id === id)?.name ?? null : null;
  const getTaskTitle = (id: number | null | undefined) =>
    id ? tasks.find((t) => t.id === id)?.title ?? null : null;

  const canEdit = !selectedNote || selectedNote.isOwner || selectedNote.visibility === "public_write";

  // ─── editor area ────────────────────────────────────────────────────────────
  const editorArea = selectedNote ? (
    <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
      {/* Note header */}
      <div className="px-4 md:px-5 pt-3 pb-2 border-b border-border shrink-0">
        {/* Top row: back (mobile), title, save indicator, dock controls */}
        <div className="flex items-center gap-2">
          {/* Back button — mobile only */}
          <button
            className="md:hidden shrink-0 p-1 -ml-1 text-muted-foreground hover:text-foreground"
            onClick={handleBack}
            aria-label="Back to notes list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <input
            key={selectedNote.id}
            defaultValue={selectedNote.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            readOnly={!canEdit}
            className="flex-1 bg-transparent text-base md:text-lg font-semibold focus:outline-none placeholder:text-muted-foreground min-w-0 disabled:cursor-default"
            placeholder="Untitled Note"
          />

          <span
            className={`text-xs flex items-center gap-1 transition-opacity duration-500 shrink-0 ${
              savedAt ? "text-primary opacity-100" : "opacity-0"
            }`}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Saved
          </span>

          {/* Preview dock controls — hidden on mobile and for read-only notes */}
          {canEdit && (
            <div className="hidden md:flex items-center gap-0.5 shrink-0">
              <DockBtn title="Hide preview"       active={dock === "hidden"} onClick={() => setDock("hidden")}><EyeOff className="w-3.5 h-3.5" /></DockBtn>
              <DockBtn title="Preview on right"   active={dock === "right"}  onClick={() => setDock("right")} ><PanelRight className="w-3.5 h-3.5" /></DockBtn>
              <DockBtn title="Preview below"      active={dock === "bottom"} onClick={() => setDock("bottom")}><PanelBottom className="w-3.5 h-3.5" /></DockBtn>
              <DockBtn
                title="Open preview in new window"
                active={dock === "window"}
                onClick={() => { setDock("window"); handleOpenWindow(); }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </DockBtn>
              {dock === "window" && (
                <Button size="sm" variant="outline" className="h-6 text-xs ml-1" onClick={handleOpenWindow}>
                  <Eye className="w-3 h-3 mr-1" /> Refresh
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Visibility toggle (owner) or read-only badge (non-owner) */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {selectedNote.isOwner ? (
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = selectedNote.visibility === opt.value;
                const Icon = opt.icon;
                return (
                  <Tooltip key={opt.value}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleVisibilityChange(opt.value)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          active
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className={`w-3 h-3 ${active ? "text-primary" : ""}`} />
                        <span className="hidden sm:inline">{opt.label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{opt.description}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${
              selectedNote.visibility === "public_write"
                ? "border-blue-500/30 bg-blue-500/5 text-blue-400"
                : "border-border bg-muted/30 text-muted-foreground"
            }`}>
              {selectedNote.visibility === "public_write"
                ? <><Edit2 className="w-3 h-3" /> Shared — you can edit</>
                : <><Eye className="w-3 h-3" /> Shared — read only</>
              }
            </span>
          )}

          {/* Link controls — editable for owners/public_write, read-only display otherwise */}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Project:</span>
                <Select value={selectedNote.projectId?.toString() ?? "none"} onValueChange={(v) => handleLinkChange("projectId", v)}>
                  <SelectTrigger className="h-6 text-xs w-36"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none"><span className="flex items-center gap-1.5 text-muted-foreground"><Link2Off className="w-3 h-3" /> None</span></SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Task:</span>
                <Select value={selectedNote.taskId?.toString() ?? "none"} onValueChange={(v) => handleLinkChange("taskId", v)}>
                  <SelectTrigger className="h-6 text-xs w-44"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none"><span className="flex items-center gap-1.5 text-muted-foreground"><Link2Off className="w-3 h-3" /> None</span></SelectItem>
                    {tasks.map((t) => <SelectItem key={t.id} value={t.id.toString()}><span className="truncate max-w-[160px] block">{t.title}</span></SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 ml-auto text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="opacity-60">Project:</span>
                <span className={selectedNote.projectId ? "text-foreground font-medium" : "opacity-50"}>
                  {getProjectName(selectedNote.projectId) ?? "None"}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="opacity-60">Task:</span>
                <span className={selectedNote.taskId ? "text-foreground font-medium" : "opacity-50"}>
                  {getTaskTitle(selectedNote.taskId) ?? "None"}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Editor + preview split (editable) — preview only (read-only) */}
      {!canEdit ? (
        <div className="flex-1 overflow-y-auto">
          <MarkdownPreview content={localContent} />
        </div>
      ) : dock === "hidden" || dock === "window" ? (
        <MarkdownEditor value={localContent} onChange={handleContentChange} className="flex-1 overflow-hidden" />
      ) : dock === "right" ? (
        <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          <Panel defaultSize={55} minSize={25}>
            <MarkdownEditor value={localContent} onChange={handleContentChange} className="h-full" />
          </Panel>
          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
          <Panel defaultSize={45} minSize={20}>
            <div className="h-full overflow-y-auto border-l border-border">
              <div className="px-2 py-1 border-b border-border bg-card">
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Preview</span>
              </div>
              <MarkdownPreview content={localContent} />
            </div>
          </Panel>
        </PanelGroup>
      ) : (
        <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
          <Panel defaultSize={55} minSize={20}>
            <MarkdownEditor value={localContent} onChange={handleContentChange} className="h-full" />
          </Panel>
          <PanelResizeHandle className="h-1 bg-border hover:bg-primary/40 transition-colors cursor-row-resize" />
          <Panel defaultSize={45} minSize={15}>
            <div className="h-full overflow-y-auto border-t border-border">
              <div className="px-3 py-1 border-b border-border bg-card">
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Preview</span>
              </div>
              <MarkdownPreview content={localContent} />
            </div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  ) : (
    <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground bg-background">
      <StickyNote className="w-12 h-12 opacity-20" />
      <p className="text-sm">Select a note or create one</p>
      <Button variant="outline" size="sm" onClick={handleNew}>
        <Plus className="w-4 h-4 mr-1" /> New note
      </Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-2rem)] -m-4 md:-m-8 overflow-hidden rounded-lg border border-border">
      {/* Note list sidebar — hidden on mobile when a note is open */}
      <div className={`${selectedId !== null ? "hidden md:flex" : "flex"} w-full md:w-64 shrink-0 flex-col border-r border-border bg-card`}>
        <div className="p-3 border-b border-border flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm flex-1">Scratch Pad</span>
          <Button
            size="icon" variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={handleNew} disabled={createNote.isPending} title="New note"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-2 border-b border-border flex flex-col gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-7 text-xs bg-background" />
          </div>
          <Select value={filterProjectId === "all" ? "all" : filterProjectId.toString()} onValueChange={(v) => setFilterProjectId(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="h-7 text-xs bg-background w-full">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><span className="text-muted-foreground">All projects</span></SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Select value={filterTaskId === "all" ? "all" : filterTaskId.toString()} onValueChange={(v) => setFilterTaskId(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="h-7 text-xs bg-background flex-1">
                <SelectValue placeholder="All tasks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><span className="text-muted-foreground">All tasks</span></SelectItem>
                {tasks.map((t) => <SelectItem key={t.id} value={t.id.toString()}><span className="truncate max-w-[160px] block">{t.title}</span></SelectItem>)}
              </SelectContent>
            </Select>
            {filtersActive && (
              <button
                onClick={() => { setFilterProjectId("all"); setFilterTaskId("all"); }}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Clear filters"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <StickyNote className="w-8 h-8 opacity-30" />
              <p className="text-xs">{search ? "No matches" : "No notes yet"}</p>
              {!search && (
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleNew}>
                  <Plus className="w-3 h-3 mr-1" /> New note
                </Button>
              )}
            </div>
          ) : (
            filteredNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                isSelected={note.id === selectedId}
                projectName={getProjectName(note.projectId)}
                taskTitle={getTaskTitle(note.taskId)}
                onClick={() => handleSelectNote(note.id)}
                onDelete={() => setDeleteTarget(note.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Editor — full width on mobile when note is open */}
      {editorArea}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>This note will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DockBtn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`p-1.5 rounded transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
    >
      {children}
    </button>
  );
}
