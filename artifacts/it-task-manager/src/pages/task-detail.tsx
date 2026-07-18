import { useGetTask, useUpdateTask, useDeleteTask, useListComments, useCreateComment, getListTasksQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeAgo } from "@/lib/utils";
import { ArrowLeft, Clock, MessageSquare, Trash2, Edit, User, Calendar, FolderGit2, AlertTriangle, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
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

export default function TaskDetail({ params }: { params: { id: string } }) {
  const taskId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [commentText, setCommentText] = useState("");

  const { data: task, isLoading: isLoadingTask } = useGetTask(taskId, {
    query: { enabled: !!taskId, queryKey: ["getTask", taskId] }
  });

  const { data: comments, isLoading: isLoadingComments } = useListComments(taskId, {
    query: { enabled: !!taskId, queryKey: ["listComments", taskId] }
  });

  const deleteMutation = useDeleteTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Task deleted successfully" });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
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

  const handlePostComment = () => {
    if (!commentText.trim()) return;
    commentMutation.mutate({
      data: { content: commentText, author: "Current User" } // hardcoded author for now
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Navigation */}
      <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground mb-2">
        <Link href="/tasks" className="hover:text-foreground flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Tasks
        </Link>
        <span>/</span>
        <span className="text-foreground">TSK-{task.id}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader className="space-y-4 pb-4 border-b border-border/50">
              <div className="flex justify-between items-start gap-4">
                <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="icon" className="h-8 w-8" title="Edit Task">
                    <Edit className="w-4 h-4" />
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
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap">
                {task.description || <span className="italic text-muted-foreground">No description provided.</span>}
              </div>
            </CardContent>
          </Card>

          {/* Activity/Comments Thread */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
                Activity Thread
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingComments ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : comments && comments.length > 0 ? (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 bg-muted/30 border border-border/50 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium">{comment.author || 'System'}</span>
                          <span className="text-xs text-muted-foreground font-mono">{formatTimeAgo(comment.createdAt)}</span>
                        </div>
                        <p className="text-sm text-foreground/80 whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg bg-card/30">
                  No comments yet. Start the conversation below.
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
                  className="font-mono text-xs uppercase tracking-wide"
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
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Properties</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border text-sm">
                
                {/* Project */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <FolderGit2 className="w-4 h-4" /> Project
                  </span>
                  {task.projectId ? (
                    <Link href={`/projects/${task.projectId}`}>
                      <span className="font-medium hover:text-primary transition-colors cursor-pointer block truncate">
                        {task.projectName}
                      </span>
                    </Link>
                  ) : (
                    <span className="italic text-muted-foreground">Unassigned</span>
                  )}
                </div>

                {/* Status - Interactive */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Status
                  </span>
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
                </div>

                {/* Priority - Interactive */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Priority
                  </span>
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
                </div>

                {/* Assignee */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <User className="w-4 h-4" /> Assignee
                  </span>
                  <span className="font-medium">{task.assignee || "Unassigned"}</span>
                </div>

                {/* Due Date */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Due Date
                  </span>
                  <span className="font-medium">{task.dueDate ? formatDate(task.dueDate) : "None"}</span>
                </div>
                
                {/* Dates */}
                <div className="p-3 flex flex-col gap-1.5 hover:bg-muted/20 transition-colors bg-muted/5">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Created
                  </span>
                  <span className="font-mono text-xs">{formatDate(task.createdAt)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
