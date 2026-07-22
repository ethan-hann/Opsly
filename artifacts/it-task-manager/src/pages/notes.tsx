import { useState, useCallback, useRef, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Plus, StickyNote, Search, Link2Off,
  Eye,
  CheckCheck, Lock, Users, ArrowLeft, Edit2, X,
  ChevronsUpDown, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { MarkdownPreview } from "@/components/notes/markdown-preview";
import { NoteCard } from "@/components/notes/note-card";
import {
  useListNotes, useCreateNote, useUpdateNote, useDeleteNote,
  NoteVisibility,
} from "@workspace/api-client-react";
import { useListProjects, useListTasks } from "@workspace/api-client-react";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

const VISIBILITY_OPTIONS: { value: NoteVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { value: "private",      label: "Private",       icon: Lock,  description: "Only you can see and edit" },
  { value: "public_read",  label: "Shared (read)", icon: Eye,   description: "Org can view, only you can edit" },
  { value: "public_write", label: "Shared (edit)", icon: Users, description: "Org can view and edit" },
];

export default function NotesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Pre-select a note when navigated here via ?note=<id> (e.g. from "Edit in Scratch Pad")
  const urlSearch = useSearch();
  const [, navigate] = useLocation();
  const noteParam = new URLSearchParams(urlSearch).get("note");
  const preselectedId = noteParam ? parseInt(noteParam, 10) : null;

  const [selectedId, setSelectedId] = useState<number | null>(preselectedId);
  const [search, setSearch] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<number | "all">("all");
  const [filterTaskId, setFilterTaskId] = useState<number | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const isMobile = useIsMobile();
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
      data: {
        title: "Untitled Note",
        content: "",
        ...(filterProjectId !== "all" ? { projectId: filterProjectId as number } : {}),
        ...(filterTaskId !== "all" ? { taskId: filterTaskId as number } : {}),
      },
    });
    setSelectedId(result.id);
    setLocalContent("");
    navigate(`/notes?note=${result.id}`);
    refetch();
  };

  const handleSelectNote = (id: number) => {
    const note = notes.find((n) => n.id === id);
    setSelectedId(id);
    setLocalContent(note?.content ?? "");
    navigate(`/notes?note=${id}`);
  };

  const handleBack = () => {
    setSelectedId(null);
    navigate("/notes");
  };

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
    toast({ title: t("notes.deleteNote") });
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
          {/* Back button - mobile only */}
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
            {t("notes.saved")}
          </span>

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
                ? <><Edit2 className="w-3 h-3" /> {t('notes.sharedCanEdit')}</>
                : <><Eye className="w-3 h-3" /> {t('notes.sharedReadOnly')}</>
              }
            </span>
          )}

          {/* Link controls - editable for owners/public_write, read-only display otherwise */}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('notes.projectLabel')}</span>
                <SearchableSelect
                  value={selectedNote.projectId?.toString() ?? "none"}
                  onValueChange={(v) => handleLinkChange("projectId", v)}
                  placeholder={t('common.none')}
                  noneLabel={t('common.none')}
                  noneIcon={<Link2Off className="w-3 h-3" />}
                  options={projects.map((p) => ({ value: p.id.toString(), label: p.name }))}
                  searchPlaceholder={t('notes.searchProjectsPlaceholder')}
                  triggerClassName="h-6 text-xs w-36"
                  contentWidth="w-48"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('notes.taskLabel')}</span>
                <SearchableSelect
                  value={selectedNote.taskId?.toString() ?? "none"}
                  onValueChange={(v) => handleLinkChange("taskId", v)}
                  placeholder={t('common.none')}
                  noneLabel={t('common.none')}
                  noneIcon={<Link2Off className="w-3 h-3" />}
                  options={tasks.map((tk) => ({ value: tk.id.toString(), label: tk.title }))}
                  searchPlaceholder={t('notes.searchTasksPlaceholder')}
                  triggerClassName="h-6 text-xs w-44"
                  contentWidth="w-64"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 ml-auto text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="opacity-60">{t('notes.projectLabel')}</span>
                <span className={selectedNote.projectId ? "text-foreground font-medium" : "opacity-50"}>
                  {getProjectName(selectedNote.projectId) ?? t('common.none')}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="opacity-60">{t('notes.taskLabel')}</span>
                <span className={selectedNote.taskId ? "text-foreground font-medium" : "opacity-50"}>
                  {getTaskTitle(selectedNote.taskId) ?? t('common.none')}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Editor (editable) or read-only rendered preview */}
      {!canEdit ? (
        <div className="flex-1 overflow-y-auto">
          <MarkdownPreview content={localContent} noteId={selectedId} />
        </div>
      ) : (
        // The MDEditor toolbar provides its own Edit / Split / Preview toggle,
        // so no separate dock/panel system is needed here.
        <MarkdownEditor
          value={localContent}
          onChange={handleContentChange}
          className="flex-1 overflow-hidden"
          previewMode="live"
        />
      )}
    </div>
  ) : (
    <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground bg-background">
      <StickyNote className="w-12 h-12 opacity-20" />
      <p className="text-sm">{t("notes.noNotesDesc")}</p>
      <Button variant="outline" size="sm" onClick={handleNew}>
        <Plus className="w-4 h-4 mr-1" /> {t("notes.newNote")}
      </Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-2rem)] -m-4 md:-m-8 overflow-hidden rounded-lg border border-border">
      {/* Note list sidebar - hidden on mobile when a note is open */}
      <div className={`${selectedId !== null ? "hidden md:flex" : "flex"} w-full md:w-64 shrink-0 flex-col border-r border-border bg-card`}>
        <div className="p-3 border-b border-border flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm flex-1">{t("notes.title")}</span>
          <Button
            size="icon" variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={handleNew} disabled={createNote.isPending} title={t('notes.newNote')}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-2 border-b border-border flex flex-col gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder={t("notes.searchNotes")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-7 text-xs bg-background" />
          </div>
          <SearchableSelect
            value={filterProjectId === "all" ? "all" : filterProjectId.toString()}
            onValueChange={(v) => setFilterProjectId(v === "all" ? "all" : Number(v))}
            placeholder={t('notes.allProjects')}
            noneLabel={t('notes.allProjects')}
            noneValue="all"
            options={projects.map((p) => ({ value: p.id.toString(), label: p.name }))}
            searchPlaceholder={t('notes.searchProjectsPlaceholder')}
            triggerClassName="h-7 text-xs bg-background w-full"
            contentWidth="w-full"
          />
          <div className="flex items-center gap-1">
            <SearchableSelect
              value={filterTaskId === "all" ? "all" : filterTaskId.toString()}
              onValueChange={(v) => setFilterTaskId(v === "all" ? "all" : Number(v))}
              placeholder={t('notes.allTasks')}
              noneLabel={t('notes.allTasks')}
              noneValue="all"
              options={tasks.map((tk) => ({ value: tk.id.toString(), label: tk.title }))}
              searchPlaceholder={t('notes.searchTasksPlaceholder')}
              triggerClassName="h-7 text-xs bg-background flex-1"
              contentWidth="w-[220px]"
            />
            {filtersActive && (
              <button
                onClick={() => { setFilterProjectId("all"); setFilterTaskId("all"); }}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={t('notes.clearFilters')}
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
              <p className="text-xs">{search ? t("common.noResults") : t("notes.noNotes")}</p>
              {!search && (
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleNew}>
                  <Plus className="w-3 h-3 mr-1" /> {t("notes.newNote")}
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

      {/* Editor - full width on mobile when note is open */}
      {editorArea}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.deleteNote")}</AlertDialogTitle>
            <AlertDialogDescription>{t("notes.deleteNoteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Searchable select combobox ───────────────────────────────────────────────
// Replaces <Select> wherever a filterable list is needed (projects, tasks).

interface SearchableSelectProps {
  value: string;
  onValueChange: (val: string) => void;
  placeholder: string;
  /** Label shown for the "none / all" option */
  noneLabel: string;
  /** Value emitted when the none option is chosen (default: "none") */
  noneValue?: string;
  /** Optional icon rendered next to the none label */
  noneIcon?: React.ReactNode;
  options: { value: string; label: string }[];
  searchPlaceholder?: string;
  triggerClassName?: string;
  /** Tailwind width class applied to the popover content (default: "w-56") */
  contentWidth?: string;
}

function SearchableSelect({
  value,
  onValueChange,
  placeholder,
  noneLabel,
  noneValue = "none",
  noneIcon,
  options,
  searchPlaceholder = "Search…",
  triggerClassName,
  contentWidth = "w-56",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);

  const selected = value === noneValue ? null : options.find((o) => o.value === value) ?? null;
  const displayLabel = selected ? selected.label : placeholder;
  const isNone = !selected;

  function handleSelect(val: string) {
    onValueChange(val);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-left ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-accent hover:text-accent-foreground transition-colors",
            triggerClassName,
          )}
        >
          <span className={cn("truncate flex-1", isNone && "text-muted-foreground")}>
            {displayLabel}
          </span>
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", contentWidth)} align="start" sideOffset={4}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 px-3 text-xs text-muted-foreground">No results found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__none__ ${noneLabel}`}
                onSelect={() => handleSelect(noneValue)}
                className="text-xs"
              >
                <Check className={cn("mr-1.5 h-3 w-3 shrink-0", isNone ? "opacity-100" : "opacity-0")} />
                {noneIcon && <span className="mr-1.5 text-muted-foreground">{noneIcon}</span>}
                <span className="text-muted-foreground">{noneLabel}</span>
              </CommandItem>
              {options.map((opt) => {
                const isSelected = value === opt.value;
                return (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.value} ${opt.label}`}
                    onSelect={() => handleSelect(opt.value)}
                    className="text-xs"
                  >
                    <Check className={cn("mr-1.5 h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
