import { useGetTask, useUpdateTask, useDeleteTask, useListComments, useCreateComment, useDeleteComment, useListProjects, useListCustomFieldDefinitions, useListTaskEvents, useListOrgMembers, useGetSLAPolicies, getListTasksQueryKey, getGetOverdueTasksQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import type { OrgMemberInfo, CustomFieldDefinition } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { formatDate, formatTimeAgo, cn } from "@/lib/utils";
import { ArrowLeft, Clock, MessageSquare, Trash2, Edit, User, Calendar as CalendarIcon, FolderGit2, AlertTriangle, Activity, History, Check, X, Tag } from "lucide-react";
import { InlineNotes } from "@/components/notes/inline-notes";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useState, useEffect, type ReactNode } from "react";
import { EditTaskModal } from "@/components/ui/edit-task-modal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@workspace/replit-auth-web";
import { useOrgContext } from "@/hooks/use-org-context";

// ─── Field change label helpers ───────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function labelFor(field: string, value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (field === "status") return STATUS_LABELS[value] ?? value;
  if (field === "priority") return PRIORITY_LABELS[value] ?? value;
  return value;
}

function eventDescription(field: string, oldValue: string | null | undefined, newValue: string | null | undefined): string {
  if (field === "created") {
    return `Task created: "${newValue ?? ""}"`;
  }

  // Custom-field audit events use a "cf:<fieldName>" prefix so they can be
  // distinguished from standard task fields and rendered with their real name.
  if (field.startsWith("cf:")) {
    const cfName = field.slice(3);
    const oldStr = oldValue || "—";
    const newStr = newValue || "—";
    if (!oldValue && newValue) return `${cfName} set to ${newStr}`;
    if (oldValue && !newValue) return `${cfName} cleared (was ${oldStr})`;
    return `${cfName} changed from ${oldStr} → ${newStr}`;
  }

  const fieldLabel: Record<string, string> = {
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    category: "Category",
    title: "Title",
    dueDate: "Due date",
    projectId: "Project",
  };

  const label = fieldLabel[field] ?? field;
  const oldStr = labelFor(field, oldValue);
  const newStr = labelFor(field, newValue);

  if (!oldValue && newValue) return `${label} set to ${newStr}`;
  if (oldValue && !newValue) return `${label} cleared (was ${oldStr})`;
  return `${label} changed from ${oldStr} → ${newStr}`;
}

// ─── Unified feed item types ──────────────────────────────────────────────────

type FeedComment = {
  kind: "comment";
  id: number;
  author: string | null;
  content: string;
  userId: string | null;
  createdAt: string;
};

type FeedEvent = {
  kind: "event";
  id: number;
  actorId: string | null;
  actorName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type FeedItem = FeedComment | FeedEvent;

// ─── Shared ghost-trigger class (matches existing Select triggers in the pane) ─

const GHOST_TRIGGER = [
  "h-8 w-full flex items-center gap-2 rounded-md -ml-2 px-2",
  "border border-transparent hover:border-border",
  "bg-transparent hover:bg-background",
  "text-sm font-medium text-left transition-colors",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
].join(" ");

// ─── Property row wrapper ─────────────────────────────────────────────────────

function PropertyRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
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

// ─── Inline assignee picker ───────────────────────────────────────────────────

function InlineAssignee({
  value,
  members,
  open,
  onOpenChange,
  onSelect,
}: {
  value: string;
  members: OrgMemberInfo[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (email: string) => void;
}) {
  const selected = members.find((m) => m.email?.toLowerCase() === value.toLowerCase());
  const label = selected
    ? ([selected.firstName, selected.lastName].filter(Boolean).join(" ") || selected.email)
    : value || null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={GHOST_TRIGGER}>
          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className={cn("truncate", !label && "text-muted-foreground italic")}>
            {label ?? "Unassigned"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__unassigned__" onSelect={() => onSelect("")}>
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground italic">Unassigned</span>
              </CommandItem>
              {members.map((member) => {
                const email = member.email ?? "";
                const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
                const isSelected = value.toLowerCase() === email.toLowerCase();
                return (
                  <CommandItem key={member.userId} value={`${name} ${email}`} onSelect={() => onSelect(email)}>
                    <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    <span className="flex flex-col leading-tight">
                      {name && <span className="text-sm font-medium">{name}</span>}
                      <span className="text-xs text-muted-foreground">{email}</span>
                    </span>
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

// ─── Inline due-date picker ───────────────────────────────────────────────────

function InlineDueDatePicker({
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
            {value ? formatDate(value) : "No due date"}
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
              onClick={() => { onChange(null); onOpenChange(false); }}
            >
              <X className="w-3.5 h-3.5" /> Clear due date
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Inline custom-field editors ─────────────────────────────────────────────

function InlineTextField({ value, onSave }: { value: unknown; onSave: (v: string | null) => void }) {
  const [local, setLocal] = useState(typeof value === "string" ? value : "");
  useEffect(() => { setLocal(typeof value === "string" ? value : ""); }, [value]);

  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onSave(local.trim() || null)}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus-visible:ring-1 text-sm font-medium"
      placeholder="—"
    />
  );
}

function InlineNumberField({ value, onSave }: { value: unknown; onSave: (v: number | null) => void }) {
  const toStr = (v: unknown) => (v !== null && v !== undefined ? String(v) : "");
  const [local, setLocal] = useState(toStr(value));
  useEffect(() => { setLocal(toStr(value)); }, [value]);

  return (
    <Input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onSave(local === "" ? null : Number(local))}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus-visible:ring-1 text-sm font-medium"
      placeholder="—"
    />
  );
}

function InlineMultiSelect({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = field.options ?? [];
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(GHOST_TRIGGER, "min-h-8 h-auto py-1 flex-wrap")}>
          {selected.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {selected.map((s) => (
                <span key={s} className="inline-flex items-center text-xs bg-secondary border border-border rounded px-1.5 py-0.5">{s}</span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground italic">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        <div className="space-y-0.5">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(ch) => {
                    onChange(ch ? [...selected, opt] : selected.filter((s) => s !== opt));
                  }}
                />
                {opt}
              </label>
            );
          })}
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">No options configured</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InlineCustomField({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "text":
      return <InlineTextField value={value} onSave={(v) => onChange(v)} />;
    case "number":
      return <InlineNumberField value={value} onSave={(v) => onChange(v)} />;
    case "date":
      return (
        <Input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus-visible:ring-1 text-sm font-medium w-full"
        />
      );
    case "single_select": {
      const options = field.options ?? [];
      const strVal = typeof value === "string" ? value : "";
      return (
        <Select value={strVal || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
          <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__"><span className="text-muted-foreground italic">—</span></SelectItem>
            {options.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case "multi_select":
      return <InlineMultiSelect field={field} value={value} onChange={(v) => onChange(v)} />;
    default:
      return (
        <span className="text-sm font-medium">
          {value != null && value !== "" ? String(value) : <span className="text-muted-foreground italic">—</span>}
        </span>
      );
  }
}

function CustomFieldReadOnly({ value }: { value: unknown }) {
  let display: string | null = null;
  if (value === null || value === undefined || value === "") {
    display = null;
  } else if (Array.isArray(value)) {
    display = (value as string[]).join(", ") || null;
  } else {
    display = String(value);
  }
  return (
    <span className="font-medium text-sm">
      {display !== null ? display : <span className="text-muted-foreground italic">—</span>}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TaskDetail({ params }: { params: { id: string } }) {
  const taskId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [commentText, setCommentText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const { data: task, isLoading: isLoadingTask } = useGetTask(taskId, {
    query: { enabled: !!taskId, queryKey: ["getTask", taskId] }
  });

  const { data: comments, isLoading: isLoadingComments } = useListComments(taskId, {
    query: { enabled: !!taskId, queryKey: ["listComments", taskId] }
  });

  const { data: events, isLoading: isLoadingEvents } = useListTaskEvents(taskId, {
    query: { enabled: !!taskId, queryKey: ["listTaskEvents", taskId] }
  });

  const deleteMutation = useDeleteTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Task deleted successfully" });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setLocation("/tasks");
      },
      onError: () => {
        toast({ title: "Failed to delete task", variant: "destructive" });
      }
    }
  });

  const updateMutation = useUpdateTask({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Task updated" });
        queryClient.setQueryData(["getTask", taskId], data);
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["listTaskEvents", taskId] });
      },
      onError: () => {
        toast({ title: "Failed to update task", variant: "destructive" });
      }
    }
  });

  const commentMutation = useCreateComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        toast({ title: "Comment posted" });
        queryClient.invalidateQueries({ queryKey: ["listComments", taskId] });
      }
    }
  });

  const deleteCommentMutation = useDeleteComment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Comment deleted" });
        queryClient.invalidateQueries({ queryKey: ["listComments", taskId] });
      },
      onError: () => {
        toast({ title: "Failed to delete comment", variant: "destructive" });
      }
    }
  });

  const { hasPermission } = useOrgContext();

  const { data: projects = [] } = useListProjects();
  const { data: customFieldDefs = [] } = useListCustomFieldDefinitions();
  const { data: members = [] } = useListOrgMembers();
  const { data: slaPolicies } = useGetSLAPolicies();

  // Gate all inline editing on edit_tasks permission
  const canEdit = hasPermission('edit_tasks');

  if (isLoadingTask) {
    return <div className="space-y-6 max-w-4xl mx-auto p-4"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!task) {
    return <div className="text-center py-12">Task not found</div>;
  }

  const handleStatusChange = (newStatus: any) => {
    updateMutation.mutate({ id: taskId, data: { status: newStatus } });
  };

  const handlePriorityChange = (newPriority: any) => {
    updateMutation.mutate({ id: taskId, data: { priority: newPriority } });
  };

  const handleProjectChange = (value: string) => {
    updateMutation.mutate({ id: taskId, data: { projectId: value === "none" ? null : Number(value) } });
  };

  const handleCategoryChange = (newCategory: string) => {
    updateMutation.mutate({ id: taskId, data: { category: newCategory as any } });
  };

  const handleAssigneeChange = (email: string) => {
    updateMutation.mutate({ id: taskId, data: { assignee: email || null } });
    setAssigneeOpen(false);
  };

  const handleDueDateChange = (date: string | null) => {
    updateMutation.mutate({ id: taskId, data: { dueDate: date } });
    setDueDateOpen(false);
  };

  const handleCustomFieldChange = (fieldId: string, value: unknown) => {
    updateMutation.mutate({ id: taskId, data: { customFields: { [fieldId]: value } } });
  };

  const handlePostComment = () => {
    if (!commentText.trim()) return;
    commentMutation.mutate({
      id: taskId,
      data: { content: commentText, author: user ? (user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user.email ?? "Unknown")) : "Unknown" }
    });
  };

  // Build unified chronological feed (comments + events, newest first)
  const feedItems: FeedItem[] = [
    ...(comments ?? []).map((c): FeedComment => ({
      kind: "comment",
      id: c.id,
      author: c.author ?? null,
      content: c.content,
      userId: (c as any).userId ?? null,
      createdAt: c.createdAt,
    })),
    ...(events ?? []).map((e): FeedEvent => ({
      kind: "event",
      id: e.id,
      actorId: e.actorId ?? null,
      actorName: e.actorName ?? null,
      field: e.field,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const isActivityLoading = isLoadingComments || isLoadingEvents;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <EditTaskModal open={editOpen} onOpenChange={setEditOpen} task={task} />
      {/* Navigation */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
        <Link href="/tasks" className="hover:text-foreground flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Tasks
        </Link>
        <span>/</span>
        <span className="text-foreground">TSK-{task.orgTaskNumber}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader className="space-y-4 pb-4 border-b border-border/50">
              <div className="flex justify-between items-start gap-4">
                <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setEditOpen(true)}>
                    <Edit className="w-3.5 h-3.5" /> Edit Task
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete Task">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete the task and all associated comments.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => deleteMutation.mutate({ id: task.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleteMutation.isPending ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                <span className="text-xs font-mono uppercase bg-secondary text-secondary-foreground px-2 py-0.5 rounded border border-border">
                  {task.category}
                </span>
                <SlaBadge
                  createdAt={task.createdAt}
                  status={task.status}
                  priority={task.priority}
                  policies={slaPolicies}
                />
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap">
                {task.description || <span className="italic text-muted-foreground">No description provided.</span>}
              </div>
            </CardContent>
          </Card>

          {/* Unified Activity & History Feed */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
                Activity &amp; History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {isActivityLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : feedItems.length > 0 ? (
                <div className="relative">
                  {/* Vertical timeline line */}
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-border" aria-hidden="true" />
                  <div className="space-y-0">
                    {feedItems.map((item) => {
                      if (item.kind === "comment") {
                        const currentUserName = user
                          ? (user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user.email ?? ""))
                          : "";
                        const isCurrentUser = !!currentUserName && item.author === currentUserName;
                        const initials = (item.author ?? "?")
                          .split(" ")
                          .filter(Boolean)
                          .map((w: string) => w[0].toUpperCase())
                          .slice(0, 2)
                          .join("");
                        const canDelete = isCurrentUser || hasPermission('manage_projects');
                        return (
                          <div key={`comment-${item.id}`} className="flex gap-3 py-3 pl-1">
                            {/* Avatar dot on timeline */}
                            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 overflow-hidden shrink-0 flex items-center justify-center z-10">
                              {isCurrentUser && user?.profileImageUrl
                                ? <img src={user.profileImageUrl} alt={item.author ?? ""} className="w-full h-full object-cover" />
                                : <span className="text-xs font-semibold text-primary select-none">{initials}</span>
                              }
                            </div>
                            <div className="flex-1 min-w-0 bg-muted/30 border border-border/50 rounded-lg p-3">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium">{item.author || "System"}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{formatTimeAgo(item.createdAt)}</span>
                                  {canDelete && (
                                    <button
                                      onClick={() => deleteCommentMutation.mutate({ id: item.id })}
                                      disabled={deleteCommentMutation.isPending}
                                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                                      title="Delete comment"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{item.content}</p>
                            </div>
                          </div>
                        );
                      }

                      // Change event
                      const isCreatedEvent = item.field === "created";
                      const actorInitials = (item.actorName ?? "?")
                        .split(" ")
                        .filter(Boolean)
                        .map((w: string) => w[0].toUpperCase())
                        .slice(0, 2)
                        .join("");

                      return (
                        <div key={`event-${item.id}`} className="flex gap-3 py-2 pl-1 items-center">
                          {/* Icon dot on timeline */}
                          <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center z-10 border ${
                            isCreatedEvent
                              ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                              : "bg-muted border-border text-muted-foreground"
                          }`}>
                            {isCreatedEvent
                              ? <Activity className="w-3.5 h-3.5" />
                              : <History className="w-3.5 h-3.5" />
                            }
                          </div>
                          <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            {item.actorName && (
                              <span className="text-xs font-medium text-foreground/80">{item.actorName}</span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {eventDescription(item.field, item.oldValue, item.newValue)}
                            </span>
                            <span className="text-xs text-muted-foreground/60 ml-auto shrink-0">
                              {formatTimeAgo(item.createdAt)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg bg-card/30">
                  No activity yet. Start the conversation below.
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t border-border p-4 flex-col items-stretch gap-3">
              <Textarea 
                placeholder="Add a comment or update..." 
                className="min-h-[80px] bg-background font-sans text-sm resize-y"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <div className="flex justify-end">
                <Button 
                  size="sm" 
                  onClick={handlePostComment}
                  disabled={!commentText.trim() || commentMutation.isPending}
                  className="text-xs"
                >
                  {commentMutation.isPending ? "Posting..." : "Post Comment"}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border py-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <InlineNotes taskId={taskId} />
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border py-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Properties</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">

                {/* Project */}
                <PropertyRow icon={<FolderGit2 className="w-4 h-4" />} label="Project">
                  {canEdit ? (
                    <Select value={task.projectId?.toString() ?? "none"} onValueChange={handleProjectChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none"><span className="italic text-muted-foreground">None</span></SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-medium">{task.projectName ?? <span className="text-muted-foreground italic">None</span>}</span>
                  )}
                </PropertyRow>

                {/* Status */}
                <PropertyRow icon={<Activity className="w-4 h-4" />} label="Status">
                  {canEdit ? (
                    <Select value={task.status} onValueChange={handleStatusChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todo">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                        <SelectItem value="done">Done</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusBadge status={task.status} />
                  )}
                </PropertyRow>

                {/* Priority */}
                <PropertyRow icon={<AlertTriangle className="w-4 h-4" />} label="Priority">
                  {canEdit ? (
                    <Select value={task.priority} onValueChange={handlePriorityChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <PriorityBadge priority={task.priority} />
                  )}
                </PropertyRow>

                {/* Category */}
                <PropertyRow icon={<Tag className="w-4 h-4" />} label="Category">
                  {canEdit ? (
                    <Select value={task.category} onValueChange={handleCategoryChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["incident","change","maintenance","deployment","support","other"] as const).map((c) => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-medium capitalize">{task.category}</span>
                  )}
                </PropertyRow>

                {/* Assignee */}
                <PropertyRow icon={<User className="w-4 h-4" />} label="Assignee">
                  {canEdit ? (
                    <InlineAssignee
                      value={task.assignee ?? ""}
                      members={members}
                      open={assigneeOpen}
                      onOpenChange={setAssigneeOpen}
                      onSelect={handleAssigneeChange}
                    />
                  ) : (
                    <span className="font-medium">{task.assignee ?? <span className="text-muted-foreground italic">Unassigned</span>}</span>
                  )}
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={<CalendarIcon className="w-4 h-4" />} label="Due Date">
                  {canEdit ? (
                    <InlineDueDatePicker
                      value={task.dueDate ?? null}
                      open={dueDateOpen}
                      onOpenChange={setDueDateOpen}
                      onChange={handleDueDateChange}
                    />
                  ) : (
                    <span className="font-medium">{task.dueDate ? formatDate(task.dueDate) : <span className="text-muted-foreground italic">No due date</span>}</span>
                  )}
                </PropertyRow>

                {/* Custom Fields */}
                {customFieldDefs.map((field) => {
                  const cfId = String(field.id);
                  const rawValue = (task.customFields as Record<string, unknown> | undefined)?.[cfId];
                  return (
                    <PropertyRow key={field.id} label={field.name}>
                      {canEdit ? (
                        <InlineCustomField
                          field={field}
                          value={rawValue}
                          onChange={(val) => handleCustomFieldChange(cfId, val)}
                        />
                      ) : (
                        <CustomFieldReadOnly value={rawValue} />
                      )}
                    </PropertyRow>
                  );
                })}

                {/* Created date — always read-only */}
                <div className="p-3 flex flex-col gap-1.5 bg-muted/5">
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Clock className="w-4 h-4" /> Created
                  </span>
                  <span className="text-xs">{formatDate(task.createdAt)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
