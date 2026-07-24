import { useTranslation } from 'react-i18next';
import { useDateLocale } from "@/hooks/use-date-locale";
import i18n from '@/i18n';
import { useGetTask, useUpdateTask, useDeleteTask, useListComments, useCreateComment, useDeleteComment, useUpdateComment, useListProjects, useListCustomFieldDefinitions, useListTaskEvents, useListOrgMembers, useGetSLAPolicies, useListWorkflowStages, useCreateTaskDependency, useDeleteTaskDependency, useGetTaskDependencies, useListTasks, getListTasksQueryKey, getGetOverdueTasksQueryKey, getGetDashboardSummaryQueryKey, getListCommentsQueryKey } from "@workspace/api-client-react";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { useTerminology } from "@/context/terminology-context";
import type { OrgMemberInfo, CustomFieldDefinition } from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { FeatureGate } from "@/components/ui/feature-gate";
import { formatDate, formatTimeAgo, cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Clock, MessageSquare, Trash2, Edit, Pencil, User, Calendar as CalendarIcon, FolderGit2, AlertTriangle, Activity, History, Check, X, Tag, Eye, EyeOff, CornerDownRight, ChevronDown, GitBranch } from "lucide-react";
import { TaskTreeVisualization } from "@/components/ui/task-tree-visualization";
import type { TaskTreeItemData } from "@/components/ui/task-tree-node";
import type { TaskDependencyEdgeData } from "@/components/ui/task-tree-visualization";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGetTaskWatchers, useWatchTask, useUnwatchTask, type WatcherInfo } from "@/hooks/use-task-watchers";
import { InlineNotes } from "@/components/notes/inline-notes";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef, type ReactNode } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownPreview } from "@/components/notes/markdown-preview";
import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins, previewComponents } from "@/components/notes/markdown-config";
import { useReactionPalette, useAddReaction, useRemoveReaction } from "@/hooks/use-reactions";
import type { ReactionSummaryType } from "@/hooks/use-reactions";

// ─── Field change label helpers ───────────────────────────────────────────────

function getStatusLabel(value: string): string {
  const map: Record<string, string> = {
    todo: i18n.t('taskDetail.statusTodo'),
    in_progress: i18n.t('taskDetail.statusInProgress'),
    blocked: i18n.t('taskDetail.statusBlocked'),
    done: i18n.t('taskDetail.statusDone'),
  };
  return map[value] ?? value;
}

function getPriorityLabel(value: string): string {
  const map: Record<string, string> = {
    low: i18n.t('tasks.priorityLow'),
    medium: i18n.t('tasks.priorityMedium'),
    high: i18n.t('tasks.priorityHigh'),
    critical: i18n.t('tasks.priorityCritical'),
  };
  return map[value] ?? value;
}

function labelFor(field: string, value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (field === "status") return getStatusLabel(value);
  if (field === "priority") return getPriorityLabel(value);
  return value;
}

function eventDescription(field: string, oldValue: string | null | undefined, newValue: string | null | undefined): string {
  if (field === "created") {
    return i18n.t('taskDetail.taskCreated', { title: newValue ?? "" });
  }

  if (field === "sla_breached") {
    // newValue is encoded as "<type>|<ISO timestamp>" (e.g. "resolution|2025-06-01T12:00:00.000Z")
    // Older events that stored only an ISO string fall back to the generic label.
    if (newValue) {
      const pipeIdx = newValue.indexOf("|");
      if (pipeIdx !== -1) {
        const slaType = newValue.slice(0, pipeIdx);
        const typeLabel = slaType === "resolution" ? i18n.t('taskDetail.resolutionLimit') : i18n.t('taskDetail.responseLimit');
        return i18n.t('taskDetail.slaBreached', { type: typeLabel });
      }
    }
    return i18n.t('taskDetail.slaDeadlineBreached');
  }

  if (field === "sla_warning") {
    if (newValue) {
      try {
        // New format: "<type>|<ISO timestamp>" e.g. "resolution|2025-06-01T12:45:00.000Z"
        // Older events stored only an ISO string — detect by presence of "|".
        const pipeIdx = newValue.indexOf("|");
        const isoStr = pipeIdx !== -1 ? newValue.slice(pipeIdx + 1) : newValue;
        const slaType = pipeIdx !== -1 ? newValue.slice(0, pipeIdx) : null;
        const typeLabel = slaType === "resolution"
          ? i18n.t('taskDetail.resolutionLimit')
          : slaType === "response"
            ? i18n.t('taskDetail.responseLimit')
            : null;

        const projected = new Date(isoStr);
        const now = new Date();
        const diffSec = Math.round((projected.getTime() - now.getTime()) / 1000);
        if (diffSec > 0) {
          const m = Math.floor(diffSec / 60);
          const s = diffSec % 60;
          const timeStr = m === 0 ? `${s}s` : s === 0 ? `${m}m` : `${m}m ${s}s`;
          return typeLabel
            ? i18n.t('taskDetail.slaWarning', { type: typeLabel, time: timeStr })
            : i18n.t('taskDetail.slaWarning', { type: "breach", time: `projected in ${timeStr}` });
        }
      } catch {
        // fall through to generic label
      }
    }
    return i18n.t('taskDetail.slaWarningFired');
  }

  // Custom-field audit events use a "cf:<fieldName>" prefix so they can be
  // distinguished from standard task fields and rendered with their real name.
  if (field.startsWith("cf:")) {
    const cfName = field.slice(3);
    const oldStr = oldValue || "—";
    const newStr = newValue || "—";
    if (!oldValue && newValue) return i18n.t('taskDetail.cfSet', { field: cfName, value: newStr });
    if (oldValue && !newValue) return i18n.t('taskDetail.cfCleared', { field: cfName, value: oldStr });
    return i18n.t('taskDetail.cfChanged', { field: cfName, old: oldStr, new: newStr });
  }

  const fieldLabel: Record<string, string> = {
    status: i18n.t('taskDetail.fieldStatus'),
    priority: i18n.t('taskDetail.fieldPriority'),
    assignee: i18n.t('taskDetail.fieldAssignee'),
    category: i18n.t('taskDetail.fieldCategory'),
    title: i18n.t('taskDetail.fieldTitle'),
    dueDate: i18n.t('taskDetail.fieldDueDate'),
    projectId: i18n.t('taskDetail.fieldProject'),
  };

  const label = fieldLabel[field] ?? field;
  const oldStr = labelFor(field, oldValue);
  const newStr = labelFor(field, newValue);

  if (!oldValue && newValue) return i18n.t('taskDetail.fieldSet', { field: label, value: newStr });
  if (oldValue && !newValue) return i18n.t('taskDetail.fieldCleared', { field: label, value: oldStr });
  return i18n.t('taskDetail.fieldChanged', { field: label, old: oldStr, new: newStr });
}

// ─── Mention / reference token preprocessing ─────────────────────────────────
// preprocessContent() converts @[...] and #[...] tokens to inline HTML before
// the markdown string enters the remark pipeline. remark-gfm extends the
// micromark PARSER phase so email addresses inside tokens would be autolinked
// before any remark transform runs; calling preprocessContent() up-front avoids that.
import { preprocessContent } from "@/lib/comment-utils";

// ─── Unified feed item types ──────────────────────────────────────────────────

type FeedComment = {
  kind: "comment";
  id: number;
  parentId: number | null;
  author: string | null;
  content: string;
  userId: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionSummaryType[];
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

// ─── Comment tree ─────────────────────────────────────────────────────────────

type CommentNode = FeedComment & { children: CommentNode[]; depth: number };

function buildCommentTree(comments: FeedComment[]): CommentNode[] {
  const byId = new Map<number, CommentNode>();
  for (const c of comments) {
    byId.set(c.id, { ...c, children: [], depth: 0 });
  }

  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId == null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parentId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        // Orphaned reply — treat as root
        roots.push(node);
      }
    }
  }

  // Propagate depths for deeper levels
  function setDepths(nodes: CommentNode[], depth: number) {
    for (const n of nodes) {
      n.depth = depth;
      setDepths(n.children, depth + 1);
    }
  }
  setDepths(roots, 0);

  // Sort children by createdAt ascending so thread reads top-to-bottom
  function sortTree(nodes: CommentNode[]) {
    nodes.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const n of nodes) sortTree(n.children);
  }
  sortTree(roots);

  return roots;
}

// ─── Recursive comment node renderer ─────────────────────────────────────────

const THREAD_COLLAPSE_DEPTH = 3;
const INDENT_PX = 20;

function CommentNodeRenderer({
  node,
  taskId,
  currentUser,
  canDeleteFn,
  onDelete,
  canEditFn,
  replyingToId,
  setReplyingToId,
  replyText,
  setReplyText,
  onPostReply,
  isPostingReply,
  commentsQueryKey,
  members,
}: {
  node: CommentNode;
  taskId: number;
  currentUser: { id?: string; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null; email?: string | null } | null;
  canDeleteFn: (comment: { userId: string | null }) => boolean;
  onDelete: (id: number) => void;
  canEditFn: (comment: { userId: string | null }) => boolean;
  replyingToId: number | null;
  setReplyingToId: (id: number | null) => void;
  replyText: string;
  setReplyText: (t: string) => void;
  onPostReply: (parentId: number) => void;
  isPostingReply: boolean;
  commentsQueryKey: readonly unknown[];
  members: import("@workspace/api-client-react").OrgMemberInfo[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [rootCollapsed, setRootCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { t: tComment, i18n: i18nComment } = useTranslation();
  const dateFnsLocaleComment = useDateLocale();

  const editMutation = useUpdateComment({
    mutation: {
      onSuccess: () => {
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: commentsQueryKey });
      },
      onError: () => {
        toast({ title: tComment('taskDetail.failedSaveEdit'), variant: "destructive" });
      },
    },
  });

  const currentUserId = currentUser?.id ?? null;
  const isCurrentUser = !!currentUser && (
    node.userId ? node.userId === currentUserId :
      (currentUser.firstName
        ? `${currentUser.firstName} ${currentUser.lastName ?? ""}`.trim() === node.author
        : currentUser.email === node.author)
  );
  const initials = (node.author ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w: string) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

  const canDelete = canDeleteFn({ userId: node.userId });
  const canEdit = canEditFn({ userId: node.userId });
  const isReplying = replyingToId === node.id;
  const hasChildren = node.children.length > 0;
  const isDeep = node.depth >= THREAD_COLLAPSE_DEPTH;

  // Left border accent — gets slightly lighter with depth
  const accentColors = [
    "border-primary/40",
    "border-blue-400/60",
    "border-violet-400/60",
    "border-emerald-400/60",
    "border-amber-400/60",
  ];
  const accentColor = accentColors[Math.min(node.depth, accentColors.length - 1)];

  // ── Tombstone rendering for soft-deleted comments ──────────────────────────
  // Preserve the indentation and thread structure; replace the bubble content
  // with italic placeholder text matching Reddit's "deleted comment" pattern.
  if (node.deleted) {
    return (
      <div style={{ marginLeft: node.depth === 0 ? 0 : INDENT_PX }}>
        <div className="flex gap-3 py-3 pl-1">
          {/* Dim avatar placeholder */}
          <div className="w-8 h-8 rounded-full bg-muted/40 border border-border/30 shrink-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground/40 select-none">?</span>
          </div>
          <div className={`flex-1 min-w-0 bg-muted/15 border border-border/30 rounded-lg px-3 py-2.5 ${node.depth > 0 ? "border-l-2 border-l-border/30" : ""}`}>
            <p className="text-sm italic text-muted-foreground/60 select-none">
              {i18n.t('taskDetail.commentDeleted')}
            </p>
          </div>
        </div>
        {/* Children still render normally below the tombstone */}
        {node.children.map((child) => (
          <CommentNodeRenderer
            key={child.id}
            node={child}
            taskId={taskId}
            currentUser={currentUser}
            canDeleteFn={canDeleteFn}
            onDelete={onDelete}
            canEditFn={canEditFn}
            replyingToId={replyingToId}
            setReplyingToId={setReplyingToId}
            replyText={replyText}
            setReplyText={setReplyText}
            onPostReply={onPostReply}
            isPostingReply={isPostingReply}
            commentsQueryKey={commentsQueryKey}
            members={members}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: node.depth === 0 ? 0 : INDENT_PX }}>
      <div className="flex gap-3 py-3 pl-1">
        {/* Avatar dot */}
        <div className={`w-8 h-8 rounded-full bg-card border ${accentColor} overflow-hidden shrink-0 flex items-center justify-center z-10`}>
          {isCurrentUser && currentUser?.profileImageUrl
            ? <img src={currentUser.profileImageUrl} alt={node.author ?? ""} className="w-full h-full object-cover" />
            : <span className="text-xs font-semibold text-primary select-none">{initials}</span>
          }
        </div>

        <div className={`flex-1 min-w-0 bg-muted/30 border border-border/50 rounded-lg p-3 ${node.depth > 0 ? "border-l-2 " + accentColor.replace("border-", "border-l-") : ""}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">{node.author || tComment('common.system')}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(node.createdAt), { addSuffix: true, locale: dateFnsLocaleComment })}</span>
              {node.editedAt && (
                <span
                  className="text-xs text-muted-foreground/60 italic"
                  title={tComment('taskDetail.editedAt', { date: new Date(node.editedAt).toLocaleString(i18nComment.language || undefined) })}
                >
                  ({tComment('common.edited')})
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  if (isReplying) {
                    setReplyingToId(null);
                    setReplyText("");
                  } else {
                    setReplyingToId(node.id);
                    setReplyText("");
                  }
                }}
                className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded text-xs flex items-center gap-0.5"
                title={tComment('taskDetail.replyToComment')}
              >
                <CornerDownRight className="w-3 h-3" />
                {tComment('common.reply')}
              </button>
              {canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditText(node.content);
                    setIsEditing(true);
                  }}
                  className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded"
                  title={tComment('taskDetail.editComment')}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => onDelete(node.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                  title={tComment('taskDetail.deleteComment')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <MarkdownEditor
                value={editText}
                onChange={setEditText}
                className="h-36 rounded-md overflow-hidden border border-border"
                previewMode="edit"
                members={members}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setIsEditing(false)}
                  disabled={editMutation.isPending}
                >
                  {tComment('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    if (!editText.trim()) return;
                    editMutation.mutate({ id: node.id, data: { content: editText.trim() } });
                  }}
                  disabled={!editText.trim() || editMutation.isPending}
                >
                  {editMutation.isPending ? i18n.t('taskDetail.saving') : i18n.t('common.save')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={previewComponents}
              >
                {preprocessContent(node.content)}
              </ReactMarkdown>
            </div>
          )}
          <CommentReactionBar
            commentId={node.id}
            reactions={node.reactions}
            currentUserId={currentUserId}
            commentsQueryKey={commentsQueryKey}
          />

          {/* Inline reply composer — hidden when the root thread is collapsed */}
          {isReplying && !(node.depth === 0 && rootCollapsed) && (
            <div className="mt-3 flex flex-col gap-2">
              <MarkdownEditor
                value={replyText}
                onChange={setReplyText}
                placeholder={tComment('taskDetail.replyTo', { author: node.author || tComment('taskDetail.addComment') })}
                className="h-32 rounded-md overflow-hidden border border-border"
                previewMode="edit"
                members={members}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => { setReplyingToId(null); setReplyText(""); }}
                >
                  {tComment('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={() => onPostReply(node.id)}
                  disabled={!replyText.trim() || isPostingReply}
                >
                  {isPostingReply ? i18n.t('taskDetail.posting') : i18n.t('common.reply')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Root-level collapse toggle — only for depth-0 comments with replies */}
      {node.depth === 0 && hasChildren && !rootCollapsed && (
        <div className="pl-11 pb-1 pt-0.5">
          <button
            type="button"
            onClick={() => setRootCollapsed(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 rotate-180" />
            {tComment('taskDetail.replyCount', { count: node.children.length, replies: node.children.length === 1 ? tComment('common.reply') : tComment('common.replies') })}
          </button>
        </div>
      )}

      {/* Collapsed placeholder — click to expand */}
      {node.depth === 0 && hasChildren && rootCollapsed && (
        <div className="pl-11 pb-2 pt-0.5">
          <button
            type="button"
            onClick={() => setRootCollapsed(false)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors italic"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {tComment('taskDetail.repliesHidden', { count: node.children.length, replies: node.children.length === 1 ? tComment('common.reply') : tComment('common.replies') })}
          </button>
        </div>
      )}

      {/* Children — hidden when root thread is collapsed */}
      {hasChildren && !rootCollapsed && (
        isDeep && !expanded ? (
          <div style={{ marginLeft: INDENT_PX }} className="pl-1 pb-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              {tComment('taskDetail.continueThread', { count: node.children.length, replies: node.children.length === 1 ? tComment('common.reply') : tComment('common.replies') })}
            </button>
          </div>
        ) : (
          <>
            {isDeep && expanded && (
              <div style={{ marginLeft: INDENT_PX }} className="pl-1 pb-1">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                  {tComment('taskDetail.collapseThread')}
                </button>
              </div>
            )}
            {node.children.map((child) => (
              <CommentNodeRenderer
                key={child.id}
                node={child}
                taskId={taskId}
                currentUser={currentUser}
                canDeleteFn={canDeleteFn}
                onDelete={onDelete}
                canEditFn={canEditFn}
                replyingToId={replyingToId}
                setReplyingToId={setReplyingToId}
                replyText={replyText}
                setReplyText={setReplyText}
                onPostReply={onPostReply}
                isPostingReply={isPostingReply}
                commentsQueryKey={commentsQueryKey}
                members={members}
              />
            ))}
          </>
        )
      )}
    </div>
  );
}

// ─── Shared inline-editing primitives (PropertyRow, GHOST_TRIGGER) ───────────
import {
  GHOST_TRIGGER,
  PropertyRow,
  InlineDueDatePicker,
} from "@/components/ui/property-panel";

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
  const { t: tTerm } = useTerminology();
  const { t } = useTranslation();
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
            {label ?? t('taskDetail.unassigned')}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('common.searchMembers', { members: tTerm("members").toLowerCase() })} />
          <CommandList>
            <CommandEmpty>{t('taskDetail.noMembersFound')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__unassigned__" onSelect={() => onSelect("")}>
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground italic">{t('taskDetail.unassigned')}</span>
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

// InlineDueDatePicker is imported from @/components/ui/property-panel above

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
  const { t } = useTranslation();
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
            <p className="text-xs text-muted-foreground px-2 py-1">{t('taskDetail.noOptionsConfigured')}</p>
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

// ─── Comment Reaction Bar ─────────────────────────────────────────────────────

function CommentReactionBar({
  commentId,
  reactions,
  currentUserId,
  commentsQueryKey,
}: {
  commentId: number;
  reactions: ReactionSummaryType[];
  currentUserId: string | null;
  commentsQueryKey: readonly unknown[];
}) {
  const { t: tReact } = useTranslation();
  const [paletteVisible, setPaletteVisible] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: paletteData } = useReactionPalette();
  const palette = paletteData?.palette ?? [];

  function openPalette() {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
    setPaletteVisible(true);
  }

  function schedulePaletteClose() {
    hideTimeout.current = setTimeout(() => setPaletteVisible(false), 120);
  }

  const addMutation = useAddReaction(commentId, commentsQueryKey, currentUserId);
  const removeMutation = useRemoveReaction(commentId, commentsQueryKey, currentUserId);

  function handleToggle(emoji: string) {
    const existing = reactions.find((r) => r.emoji === emoji);
    const hasReacted = existing?.userIds.includes(currentUserId ?? "") ?? false;
    if (hasReacted) {
      removeMutation.mutate({ emoji });
    } else {
      addMutation.mutate({ emoji });
    }
  }

  // Current user's reactions always first, then sort by count descending
  const sortedReactions = [...reactions].sort((a, b) => {
    const aOwn = currentUserId ? a.userIds.includes(currentUserId) : false;
    const bOwn = currentUserId ? b.userIds.includes(currentUserId) : false;
    if (aOwn !== bOwn) return aOwn ? -1 : 1;
    return b.count - a.count;
  });

  // The trigger shows the first palette emoji (typically 👍) as a hint
  const triggerEmoji = palette[0] ?? "👍";

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2">
      {sortedReactions.map((r) => {
        const hasReacted = currentUserId ? r.userIds.includes(currentUserId) : false;
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => handleToggle(r.emoji)}
            disabled={addMutation.isPending || removeMutation.isPending}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              hasReacted
                ? "border-primary/60 bg-primary/10 text-primary font-medium"
                : "border-border bg-background hover:bg-muted text-foreground/70",
            ].join(" ")}
            title={tReact('taskDetail.reactionCount_other', { count: r.count })}
          >
            <span>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        );
      })}

      {/* Hover-activated reaction palette — LinkedIn/Facebook style */}
      {palette.length > 0 && (
        <div
          className="relative"
          onMouseEnter={openPalette}
          onMouseLeave={schedulePaletteClose}
        >
          <button
            type="button"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary text-sm transition-colors leading-none"
            title={tReact('taskDetail.addReaction')}
            aria-label={tReact('taskDetail.addReaction')}
          >
            {triggerEmoji}
          </button>

          {paletteVisible && (
            <div
              className="absolute bottom-full left-0 mb-1.5 z-50 flex items-center gap-0.5 bg-popover border border-border rounded-2xl shadow-lg px-2 py-1.5"
              onMouseEnter={openPalette}
              onMouseLeave={schedulePaletteClose}
            >
              {palette.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setPaletteVisible(false);
                    handleToggle(emoji);
                  }}
                  className="text-xl leading-none hover:scale-125 transition-transform rounded p-0.5 focus:outline-none"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Watcher Avatar Stack ─────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
];

function watcherInitials(w: WatcherInfo): string {
  const first = w.firstName?.[0] ?? "";
  const last = w.lastName?.[0] ?? "";
  if (first || last) return (first + last).toUpperCase();
  return (w.email?.[0] ?? "?").toUpperCase();
}

function watcherDisplayName(w: WatcherInfo): string {
  const name = [w.firstName, w.lastName].filter(Boolean).join(" ");
  return name || w.email || "Unknown";
}

/**
 * Overlapping circular avatars for up to 5 watchers, with a "+N" overflow
 * badge and a popover listing all watchers by name.
 */
function WatcherAvatarStack({
  watchers,
  totalCount,
}: {
  watchers: WatcherInfo[];
  totalCount: number;
}) {
  if (totalCount === 0 || watchers.length === 0) return null;

  const displayed = watchers.slice(0, 5);
  const overflow = totalCount - displayed.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          title={i18n.t('taskDetail.seeWatchers')}
          aria-label={`${totalCount} ${totalCount === 1 ? i18n.t('taskDetail.watchersCount', { count: 1 }) : i18n.t('taskDetail.watchersCount_plural', { count: totalCount })} — click to see list`}
        >
          <div className="flex -space-x-2">
            {displayed.map((w, i) => {
              const initials = watcherInitials(w);
              const colorClass = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
              return (
                <div
                  key={w.userId}
                  className={cn(
                    "w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white shrink-0 overflow-hidden",
                    colorClass,
                  )}
                  style={{ zIndex: displayed.length - i }}
                  title={watcherDisplayName(w)}
                >
                  {w.profileImageUrl ? (
                    <img
                      src={w.profileImageUrl}
                      alt={initials}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
              );
            })}
            {overflow > 0 && (
              <div
                className="w-7 h-7 rounded-full border-2 border-background bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ zIndex: 0 }}
              >
                +{overflow}
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="end">
        <p className="text-xs font-semibold text-muted-foreground px-1 mb-2">
          {totalCount === 1 ? i18n.t('taskDetail.watchersCount', { count: 1 }) : i18n.t('taskDetail.watchersCount_plural', { count: totalCount })}
        </p>
        <ul className="space-y-0.5">
          {watchers.map((w, i) => (
            <li key={w.userId} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50">
              <div
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 overflow-hidden",
                  AVATAR_PALETTE[i % AVATAR_PALETTE.length],
                )}
              >
                {w.profileImageUrl ? (
                  <img src={w.profileImageUrl} alt={watcherInitials(w)} className="w-full h-full object-cover" />
                ) : (
                  watcherInitials(w)
                )}
              </div>
              <span className="text-sm truncate">{watcherDisplayName(w)}</span>
            </li>
          ))}
          {overflow > 0 && (
            <li className="px-1 py-1 text-xs text-muted-foreground italic">
              +{overflow} more…
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TaskDetail({ params }: { params: { id: string } }) {
  const taskId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const fromSearch = new URLSearchParams(searchString).get("from") === "search";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasPermission } = useOrgContext();
  const { t: term, tSingular } = useTerminology();
  const { t, i18n } = useTranslation();
  const dateFnsLocale = useDateLocale();

  const [commentText, setCommentText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");

  // ── Watchers ──────────────────────────────────────────────────────────────
  const { data: watchersData } = useGetTaskWatchers(taskId);
  const watchMutation = useWatchTask(taskId);
  const unwatchMutation = useUnwatchTask(taskId);
  const isWatching = watchersData?.isWatching ?? false;
  const watcherCount = watchersData?.count ?? 0;

  const handleToggleWatch = () => {
    if (isWatching) {
      unwatchMutation.mutate(undefined, {
        onSuccess: () => toast({ title: t('taskDetail.unwatchedTask') }),
        onError: () => toast({ title: t('taskDetail.failedUnwatch'), variant: "destructive" }),
      });
    } else {
      watchMutation.mutate(undefined, {
        onSuccess: () => toast({ title: t('taskDetail.watchingTask') }),
        onError: () => toast({ title: t('taskDetail.failedWatch'), variant: "destructive" }),
      });
    }
  };

  const { data: task, isLoading: isLoadingTask } = useGetTask(taskId, {
    query: { enabled: !!taskId, queryKey: ["getTask", taskId] }
  });
  const { isFeatureEnabled } = useOrgContext();
  const taskTreesEnabled = isFeatureEnabled("task_trees");

  const { data: stages = [] } = useListWorkflowStages();

  const { data: comments, isLoading: isLoadingComments } = useListComments(taskId, {
    query: { enabled: !!taskId, queryKey: getListCommentsQueryKey(taskId) }
  });

  const { data: events, isLoading: isLoadingEvents } = useListTaskEvents(taskId, {
    query: {
      // Only fetch if the user has the audit-log permission. Without it the
      // server returns 403, which causes a retry/refetch loop that makes the
      // Activity & History section flash every few seconds.
      enabled: !!taskId && hasPermission('view_audit_log'),
      queryKey: ["listTaskEvents", taskId],
    },
  });

  const deleteMutation = useDeleteTask({
    mutation: {
      onSuccess: () => {
        toast({ title: t('taskDetail.taskDeleted') });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setLocation("/tasks");
      },
      onError: () => {
        toast({ title: t('taskDetail.failedDeleteTask'), variant: "destructive" });
      }
    }
  });

  const updateMutation = useUpdateTask({
    mutation: {
      onSuccess: (data) => {
        toast({ title: t('taskDetail.taskUpdated') });
        // Merge PATCH response into the existing cache entry so enriched fields
        // (dependencies, dependents) that PATCH doesn't return are preserved.
        queryClient.setQueryData(["getTask", taskId], (old: unknown) =>
          old && typeof old === "object" ? { ...(old as object), ...data } : data,
        );
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOverdueTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["listTaskEvents", taskId] });
      },
      onError: (err: unknown) => {
        // ApiError exposes .status and .data directly (not .response.*)
        const apiErr = err as { status?: number; data?: { error?: string } };
        const msg = apiErr?.data?.error;
        toast({ title: msg ?? t('taskDetail.failedUpdateTask'), variant: "destructive" });
      }
    }
  });

  // Task dependency hooks for the Task Tree section
  const { mutate: createDep } = useCreateTaskDependency({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dependency added" });
        queryClient.invalidateQueries({ queryKey: ["getTask", taskId] });
      },
      onError: (err: unknown) => {
        const apiErr = err as { status?: number; data?: { error?: string } };
        const msg = apiErr?.data?.error ?? "Failed to add dependency";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const { mutate: removeDep } = useDeleteTaskDependency({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dependency removed" });
        queryClient.invalidateQueries({ queryKey: ["getTask", taskId] });
      },
      onError: () => {
        toast({ title: "Failed to remove dependency", variant: "destructive" });
      },
    },
  });

  const commentMutation = useCreateComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        toast({ title: t('taskDetail.commentPosted') });
        queryClient.invalidateQueries({ queryKey: ["listComments", taskId] });
      }
    }
  });

  const replyMutation = useCreateComment({
    mutation: {
      onSuccess: () => {
        setReplyText("");
        setReplyingToId(null);
        toast({ title: t('taskDetail.replyPosted') });
        queryClient.invalidateQueries({ queryKey: ["listComments", taskId] });
      },
      onError: () => {
        toast({ title: t('taskDetail.failedReply'), variant: "destructive" });
      }
    }
  });

  const deleteCommentMutation = useDeleteComment({
    mutation: {
      onSuccess: () => {
        toast({ title: t('taskDetail.commentDeleted') });
        queryClient.invalidateQueries({ queryKey: ["listComments", taskId] });
      },
      onError: () => {
        toast({ title: t('taskDetail.failedDeleteComment'), variant: "destructive" });
      }
    }
  });

  const { data: projects = [] } = useListProjects();
  const { data: customFieldDefs = [] } = useListCustomFieldDefinitions();
  const { data: members = [] } = useListOrgMembers();
  const { data: slaPolicies } = useGetSLAPolicies();

  // Gate all inline editing on edit_tasks permission
  const canEdit = hasPermission('edit_tasks');
  const canDelete = hasPermission('delete_tasks');
  const canClose = hasPermission('close_tasks');

  if (isLoadingTask) {
    return <div className="space-y-6 max-w-4xl mx-auto p-4"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!task) {
    return <div className="text-center py-12">{t('taskDetail.notFound')}</div>;
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
      data: { content: commentText, author: user ? (user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user.email ?? i18n.t('common.unknown'))) : i18n.t('common.unknown') }
    });
  };

  const handlePostReply = (parentId: number) => {
    if (!replyText.trim()) return;
    replyMutation.mutate({
      id: taskId,
      data: {
        content: replyText,
        author: user ? (user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : (user.email ?? i18n.t('common.unknown'))) : i18n.t('common.unknown'),
        parentId,
      },
    });
  };

  // Build all feed comments (flat), then construct the tree
  const allFeedComments: FeedComment[] = (comments ?? []).map((c): FeedComment => ({
    kind: "comment",
    id: c.id,
    parentId: c.parentId ?? null,
    author: c.author ?? null,
    content: c.content,
    userId: c.userId ?? null,
    deleted: c.deleted ?? false,
    createdAt: c.createdAt,
    editedAt: c.editedAt ?? null,
    reactions: c.reactions ?? [],
  }));

  const commentTree = buildCommentTree(allFeedComments);

  // Discussion: root comments sorted newest-first
  const discussionItems = [...commentTree].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // History: change events sorted newest-first
  const historyItems: FeedEvent[] = (events ?? []).map((e): FeedEvent => ({
    kind: "event",
    id: e.id,
    actorId: e.actorId ?? null,
    actorName: e.actorName ?? null,
    field: e.field,
    oldValue: e.oldValue ?? null,
    newValue: e.newValue ?? null,
    createdAt: e.createdAt,
  })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const canDeleteComment = (comment: { userId: string | null }) => {
    const currentUserId = user?.id ?? null;
    const isOwner = comment.userId != null && comment.userId === currentUserId;
    return isOwner || hasPermission('delete_comments');
  };

  const canEditComment = (comment: { userId: string | null }) => {
    const currentUserId = user?.id ?? null;
    const isOwner = comment.userId != null && comment.userId === currentUserId;
    return isOwner || hasPermission('edit_comments');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <EditTaskModal open={editOpen} onOpenChange={setEditOpen} task={task} />
      {/* Navigation */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
        {fromSearch && (
          <>
            <button
              type="button"
              onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/tasks")}
              className="hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </button>
            <span>/</span>
          </>
        )}
        <Link href="/tasks" className="hover:text-foreground flex items-center gap-1 transition-colors">
          {!fromSearch && <ArrowLeft className="w-4 h-4" />}
          {term("tasks")}
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
                <div className="flex items-center gap-2 shrink-0">
                  {/* Watcher avatar stack — shown when at least one person is watching */}
                  <WatcherAvatarStack
                    watchers={watchersData?.watchers ?? []}
                    totalCount={watcherCount}
                  />
                  {/* Watch / Unwatch button */}
                  <Button
                    variant={isWatching ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={handleToggleWatch}
                    disabled={watchMutation.isPending || unwatchMutation.isPending}
                    title={isWatching ? t('taskDetail.unwatchTitle') : t('taskDetail.watchTitle')}
                  >
                    {isWatching ? (
                      <><EyeOff className="w-3.5 h-3.5" /> {t('tasks.unwatchTask')}</>
                    ) : (
                      <><Eye className="w-3.5 h-3.5" /> {t('tasks.watchTask')}</>
                    )}
                  </Button>
                  {canEdit && (
                    <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setEditOpen(true)}>
                      <Edit className="w-3.5 h-3.5" /> {t('taskDetail.editTask', { task: tSingular("tasks") })}
                    </Button>
                  )}
                  {canDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" title={t('taskDetail.deleteTask', { task: tSingular("tasks") })}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('taskDetail.deleteTaskConfirm', { task: tSingular("tasks").toLowerCase() })}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('taskDetail.deleteTaskDesc')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate({ id: task.id })}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {deleteMutation.isPending ? t('common.deleting') : t('taskDetail.deleteConfirmButton')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={task.status} stageName={task.stageName} stageColor={task.stageColor} stageArchived={task.stageArchived} />
                <PriorityBadge priority={task.priority} />
                <span className="text-xs font-mono uppercase bg-secondary text-secondary-foreground px-2 py-0.5 rounded border border-border">
                  {t(`tasks.category${task.category.charAt(0).toUpperCase() + task.category.slice(1)}` as any)}
                </span>
                <FeatureGate feature="sla_tracking" compact>
                  <SlaBadge
                    createdAt={task.createdAt}
                    updatedAt={task.updatedAt}
                    status={task.status}
                    priority={task.priority}
                    policies={slaPolicies}
                    stageType={task.stageType as "open" | "closed" | undefined}
                  />
                </FeatureGate>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="text-foreground/90">
                {task.description ? (
                  <MarkdownPreview content={task.description} className="px-0 py-0" />
                ) : (
                  <span className="italic text-muted-foreground text-sm">{t('taskDetail.noDescription')}</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Task Tree section */}
          <FeatureGate feature="task_trees" compact>
            <TaskDetailTreeSection
              task={task}
              createDep={createDep}
              removeDep={removeDep}
            />
          </FeatureGate>

          {/* Activity — Discussion + History tabs */}
          <Card className="border-border shadow-sm">
            <Tabs defaultValue="discussion">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-muted-foreground" />
                    {t('taskDetail.activity')}
                  </CardTitle>
                  <TabsList>
                    <TabsTrigger value="discussion">
                      <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                      {t('taskDetail.discussion')}
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      <History className="w-3.5 h-3.5 mr-1.5" />
                      {t('taskDetail.history')}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </CardHeader>

              {/* ── Discussion tab ── */}
              <TabsContent value="discussion">
                <CardFooter className="bg-muted/10 border-b border-border p-4 flex-col items-stretch gap-3">
                  <MarkdownEditor
                    value={commentText}
                    onChange={setCommentText}
                    placeholder={t('taskDetail.addComment')}
                    className="h-40 rounded-md overflow-hidden border border-border"
                    previewMode="edit"
                    members={members}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {t('taskDetail.mentionHint')}
                    </span>
                    <Button
                      size="sm"
                      onClick={handlePostComment}
                      disabled={!commentText.trim() || commentMutation.isPending}
                      className="text-xs"
                    >
                      {commentMutation.isPending ? t('taskDetail.posting') : t('taskDetail.postComment')}
                    </Button>
                  </div>
                </CardFooter>
                <CardContent className="space-y-1">
                  {isLoadingComments ? (
                    <div className="space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : discussionItems.length > 0 ? (
                    <div className="space-y-0">
                      {discussionItems.map((node) => (
                        <CommentNodeRenderer
                          key={`comment-${node.id}`}
                          node={node}
                          taskId={taskId}
                          currentUser={user}
                          canDeleteFn={canDeleteComment}
                          onDelete={(id) => deleteCommentMutation.mutate({ id })}
                          canEditFn={canEditComment}
                          replyingToId={replyingToId}
                          setReplyingToId={setReplyingToId}
                          replyText={replyText}
                          setReplyText={setReplyText}
                          onPostReply={handlePostReply}
                          isPostingReply={replyMutation.isPending}
                          commentsQueryKey={getListCommentsQueryKey(taskId)}
                          members={members}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg bg-card/30">
                      {t('taskDetail.noComments')}
                    </div>
                  )}
                </CardContent>
              </TabsContent>

              {/* ── History tab ── */}
              <TabsContent value="history">
                <CardContent className="space-y-1 pb-6">
                  {isLoadingEvents ? (
                    <div className="space-y-4">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : historyItems.length > 0 ? (
                    <div className="relative">
                      {/* Vertical timeline line */}
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" aria-hidden="true" />
                      <div className="space-y-0">
                        {historyItems.map((item) => {
                          const isCreatedEvent = item.field === "created";
                          const isBreachEvent  = item.field === "sla_breached";
                          const isWarningEvent = item.field === "sla_warning";
                          return (
                            <div key={`event-${item.id}`} className="flex gap-3 py-2 pl-1 items-center">
                              {/* Icon dot on timeline — bg-card gives a solid opaque base */}
                              <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center z-10 border bg-card ${
                                isCreatedEvent
                                  ? "border-green-500/50 text-green-600 dark:text-green-400"
                                  : isBreachEvent
                                  ? "border-destructive/50 text-destructive"
                                  : isWarningEvent
                                  ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
                                  : "border-border text-muted-foreground"
                              }`}>
                                {isCreatedEvent
                                  ? <Activity className="w-3.5 h-3.5" />
                                  : isBreachEvent
                                  ? <Clock className="w-3.5 h-3.5" />
                                  : isWarningEvent
                                  ? <AlertTriangle className="w-3.5 h-3.5" />
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
                                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: dateFnsLocale })}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg bg-card/30">
                      {hasPermission("view_audit_log")
                        ? t('taskDetail.noHistory')
                        : t('taskDetail.noHistory')}
                    </div>
                  )}
                </CardContent>
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border py-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('taskDetail.notes')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <InlineNotes taskId={taskId} />
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader className="bg-muted/20 border-b border-border py-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('common.details')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">

                {/* Project */}
                <PropertyRow icon={<FolderGit2 className="w-4 h-4" />} label={term("projects")}>

                  {canEdit ? (
                    <Select value={task.projectId?.toString() ?? "none"} onValueChange={handleProjectChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue placeholder={t('common.none')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none"><span className="italic text-muted-foreground">{t('common.none')}</span></SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-medium">{task.projectName ?? <span className="text-muted-foreground italic">{t('common.none')}</span>}</span>
                  )}
                </PropertyRow>

                {/* Status */}
                <PropertyRow icon={<Activity className="w-4 h-4" />} label={t('common.status')}>
                  {canEdit && (canClose || task.stageType !== 'closed') ? (
                    <Select value={task.status} onValueChange={handleStatusChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages
                          .filter((s) => !s.archivedAt && (canClose || s.type !== 'closed'))
                          .map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        {/* Show current archived stage so it doesn't disappear */}
                        {task.stageArchived && (
                          <SelectItem value={task.status} className="text-muted-foreground">
                            {task.stageName} (archived)
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusBadge status={task.status} stageName={task.stageName} stageColor={task.stageColor} stageArchived={task.stageArchived} />
                  )}
                </PropertyRow>

                {/* Priority */}
                <PropertyRow icon={<AlertTriangle className="w-4 h-4" />} label={t('common.priority')}>
                  {canEdit ? (
                    <Select value={task.priority} onValueChange={handlePriorityChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('tasks.priorityLow')}</SelectItem>
                        <SelectItem value="medium">{t('tasks.priorityMedium')}</SelectItem>
                        <SelectItem value="high">{t('tasks.priorityHigh')}</SelectItem>
                        <SelectItem value="critical">{t('tasks.priorityCritical')}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <PriorityBadge priority={task.priority} />
                  )}
                </PropertyRow>

                {/* Category */}
                <PropertyRow icon={<Tag className="w-4 h-4" />} label={t('tasks.filterByCategory')}>
                  {canEdit ? (
                    <Select value={task.category} onValueChange={handleCategoryChange}>
                      <SelectTrigger className="h-8 border-transparent hover:border-border bg-transparent hover:bg-background -ml-2 px-2 shadow-none focus:ring-0 w-full justify-between">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["incident","change","maintenance","deployment","support","other"] as const).map((c) => (
                          <SelectItem key={c} value={c}>{t(`tasks.category${c.charAt(0).toUpperCase() + c.slice(1)}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-medium">{t(`tasks.category${task.category.charAt(0).toUpperCase() + task.category.slice(1)}` as any)}</span>
                  )}
                </PropertyRow>

                {/* Assignee */}
                <PropertyRow icon={<User className="w-4 h-4" />} label={t('common.assignee')}>
                  {canEdit ? (
                    <InlineAssignee
                      value={task.assignee ?? ""}
                      members={members}
                      open={assigneeOpen}
                      onOpenChange={setAssigneeOpen}
                      onSelect={handleAssigneeChange}
                    />
                  ) : (
                    <span className="font-medium">{task.assignee ?? <span className="text-muted-foreground italic">{t('taskDetail.unassigned')}</span>}</span>
                  )}
                </PropertyRow>

                {/* Due Date */}
                <PropertyRow icon={<CalendarIcon className="w-4 h-4" />} label={t('common.dueDate')}>
                  {canEdit ? (
                    <InlineDueDatePicker
                      value={task.dueDate ?? null}
                      open={dueDateOpen}
                      onOpenChange={setDueDateOpen}
                      onChange={handleDueDateChange}
                    />
                  ) : (
                    <span className="font-medium">{task.dueDate ? formatDate(task.dueDate, i18n.language) : <span className="text-muted-foreground italic">{t('taskDetail.noDueDate')}</span>}</span>
                  )}
                </PropertyRow>

                {/* Custom Fields */}
                <FeatureGate feature="custom_fields">
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
                </FeatureGate>

                {/* Created date — always read-only */}
                <div className="p-3 flex flex-col gap-1.5 bg-muted/5">
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Clock className="w-4 h-4" /> {t('common.created')}
                  </span>
                  <span className="text-xs">{formatDate(task.createdAt, i18n.language)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Task Detail Tree Section ─────────────────────────────────────────────────

function TaskDetailTreeSection({
  task,
  createDep,
  removeDep,
}: {
  task: {
    id: number;
    orgTaskNumber: number;
    title: string;
    stageName?: string | null;
    stageType?: string | null;
    isClosed?: boolean;
    projectId?: number | null;
    dependencies?: Array<{ id: number; orgTaskNumber: number; title: string; stageName: string; isClosed: boolean }>;
    dependents?: Array<{ id: number; orgTaskNumber: number; title: string; stageName: string; isClosed: boolean }>;
    autoCloseChildren?: boolean;
  };
  createDep: (args: { data: { taskId: number; dependsOnTaskId: number } }) => void;
  removeDep: (args: { id: number }) => void;
}) {
  const { t: term, tSingular } = useTerminology();
  const { hasPermission, isFeatureEnabled } = useOrgContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { mutate: updateTask } = useUpdateTask({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Auto-close children setting updated" });
        // Merge so dependencies/dependents from the enriched GET are preserved.
        queryClient.setQueryData(["getTask", task.id], (old: unknown) =>
          old && typeof old === "object" ? { ...(old as object), ...data } : data,
        );
      },
      onError: () => {
        toast({ title: "Failed to update setting", variant: "destructive" });
      },
    },
  });

  const canLinkTasks = isFeatureEnabled("task_trees") && hasPermission("link_tasks");
  const canClose = hasPermission("close_tasks");

  const deps = task.dependencies ?? [];
  const dependents = task.dependents ?? [];

  // Build task item list: all deps + dependents + self
  const allItems: TaskTreeItemData[] = [
    {
      id: task.id,
      orgTaskNumber: task.orgTaskNumber,
      title: task.title,
      stageName: task.stageName ?? "Unknown",
      isClosed: task.stageType === "closed",
    },
    ...deps.map((d) => ({
      id: d.id,
      orgTaskNumber: d.orgTaskNumber,
      title: d.title,
      stageName: d.stageName,
      isClosed: d.isClosed,
    })),
    ...dependents.map((d) => ({
      id: d.id,
      orgTaskNumber: d.orgTaskNumber,
      title: d.title,
      stageName: d.stageName,
      isClosed: d.isClosed,
    })),
  ];

  // Build edges: dependency edges (parent→this task) + dependent edges (this task→child)
  const edges: TaskDependencyEdgeData[] = [
    ...deps.map((d) => ({ id: d.id * 10000 + task.id, taskId: task.id, dependsOnTaskId: d.id })),
    ...dependents.map((d) => ({ id: task.id * 10000 + d.id, taskId: d.id, dependsOnTaskId: task.id })),
  ];

  const openDepsCount = deps.filter((d) => !d.isClosed).length;

  // Fetch all project tasks — needed for the dependency picker candidate pool
  const { data: projectTasksRaw = [] } = useListTasks(
    { projectId: task.projectId! },
    { query: { enabled: !!task.projectId, queryKey: ["listTasks", { projectId: task.projectId }] } },
  );
  const candidateTasks: TaskTreeItemData[] = projectTasksRaw.map((t) => ({
    id: t.id,
    orgTaskNumber: t.orgTaskNumber,
    title: t.title,
    stageName: t.stageName ?? "Unknown",
    isClosed: t.stageType === "closed",
  }));

  // Fetch real edge IDs for the whole project so remove works correctly
  const depQueryParams = task.projectId ? { projectId: task.projectId } : { projectId: 0 };
  const { data: projectEdges = [] } = useGetTaskDependencies(depQueryParams, {
    query: {
      enabled: !!task.projectId,
      queryKey: ["getTaskDependencies", depQueryParams],
    },
  });

  // Build a real edge map from the project's full edge list
  const realEdges: TaskDependencyEdgeData[] = projectEdges
    .filter((e) => e.taskId === task.id || e.dependsOnTaskId === task.id)
    .map((e) => ({ id: e.id, taskId: e.taskId, dependsOnTaskId: e.dependsOnTaskId }));

  const edgesForViz = realEdges.length > 0 ? realEdges : edges;

  return (
    <Card className="border-border shadow-sm" data-testid="task-tree-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          Task Tree
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Blocked banner */}
        {openDepsCount > 0 && (
          <div
            data-testid="blocked-banner"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Blocked — {openDepsCount} open{" "}
              {openDepsCount === 1 ? tSingular("tasks").toLowerCase() : term("tasks").toLowerCase()}{" "}
              must be completed first:{" "}
              {deps
                .filter((d) => !d.isClosed)
                .map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/tasks/${d.id}`}
                      className="font-mono underline underline-offset-2 hover:opacity-70"
                    >
                      TSK-{d.orgTaskNumber}
                    </Link>
                  </span>
                ))}
            </span>
          </div>
        )}

        <TaskTreeVisualization
          tasks={allItems}
          edges={edgesForViz}
          focusedTaskId={task.id}
          candidateTasks={candidateTasks}
          onAddDependency={(taskId, dependsOnTaskId) => {
            createDep({ data: { taskId, dependsOnTaskId } });
          }}
          onRemoveDependency={(childTaskId, dependsOnId) => {
            const edge = edgesForViz.find(
              (e) => e.taskId === childTaskId && e.dependsOnTaskId === dependsOnId,
            );
            if (edge) removeDep({ id: edge.id });
          }}
        />

        {/* View full tree link */}
        {task.projectId && (
          <div className="pt-1">
            <Link
              href={`/projects/${task.projectId}?tab=task-tree&focus=${task.id}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View full tree →
            </Link>
          </div>
        )}

        {/* Auto-close children toggle */}
        {canClose && (
          <div className="flex items-center gap-3 pt-1 border-t border-border/60">
            <Switch
              id={`auto-close-${task.id}`}
              checked={task.autoCloseChildren ?? false}
              onCheckedChange={(checked) => {
                updateTask({ id: task.id, data: { autoCloseChildren: checked } });
              }}
            />
            <Label htmlFor={`auto-close-${task.id}`} className="text-sm cursor-pointer">
              Auto-close children when this {tSingular("tasks").toLowerCase()} is closed
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
