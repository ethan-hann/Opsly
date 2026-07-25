/**
 * DevTestTreePage — dev-only fixture page for end-to-end touch-drag tests.
 *
 * Accessible at /dev-test/tree without authentication so Playwright can test
 * the native touch event path in TaskTreeVisualization.  Only rendered when
 * import.meta.env.DEV is true; the route is not present in production builds.
 *
 * Provides the minimal React context needed by the tree:
 *  - QueryClientProvider (for useGetMyOrg inside TerminologyProvider)
 *  - OrgContext with link_tasks permission enabled
 *  - TerminologyProvider (falls back to i18n defaults when no org data)
 *  - wouter Router (for Link hrefs inside tree nodes)
 */

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { OrgContext } from "@/hooks/use-org-context";
import type { OrgContextValue } from "@/hooks/use-org-context";
import { TerminologyProvider } from "@/context/terminology-context";
import { TaskTreeVisualization } from "@/components/ui/task-tree-visualization";
import type { TaskTreeItemData } from "@/components/ui/task-tree-node";
import type { TaskDependencyEdgeData } from "@/components/ui/task-tree-visualization";

// ─── Minimal mock org context ─────────────────────────────────────────────────

const mockOrgCtx: OrgContextValue = {
  org: null,
  roleId: "admin",
  roleName: "Admin",
  permissions: null,
  pendingInvitation: null,
  isAdmin: true,
  isOwner: true,
  hasPermission: () => true,
  refetchOrg: () => {},
  features: {},
  isFeatureEnabled: () => true,
  isFeatureUnsubscribed: () => false,
};

// ─── Query client that never retries (avoids noise from 401s in dev tests) ────

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

// ─── Test tasks + edges ───────────────────────────────────────────────────────

const INITIAL_TASKS: TaskTreeItemData[] = [
  { id: 1, orgTaskNumber: 1, title: "Task Alpha", stageName: "Open", isClosed: false },
  { id: 2, orgTaskNumber: 2, title: "Task Beta",  stageName: "Open", isClosed: false },
  { id: 3, orgTaskNumber: 3, title: "Task Gamma", stageName: "Open", isClosed: false },
];

// Beta depends on Alpha (Alpha is parent of Beta); Gamma is a root.
const INITIAL_EDGES: TaskDependencyEdgeData[] = [
  { id: 1, taskId: 2, dependsOnTaskId: 1 },
];

// ─── Controlled tree wrapper ──────────────────────────────────────────────────

function ControlledTree() {
  const [edges, setEdges] = useState<TaskDependencyEdgeData[]>(INITIAL_EDGES);

  function handleAdd(taskId: number, dependsOnTaskId: number) {
    setEdges((prev) => [
      ...prev,
      { id: Date.now(), taskId, dependsOnTaskId },
    ]);
  }

  function handleRemove(taskId: number, dependsOnTaskId: number) {
    setEdges((prev) =>
      prev.filter(
        (e) => !(e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId),
      ),
    );
  }

  function handleMove(taskId: number, oldParentId: number, newParentId: number) {
    setEdges((prev) =>
      prev.map((e) =>
        e.taskId === taskId && e.dependsOnTaskId === oldParentId
          ? { ...e, dependsOnTaskId: newParentId }
          : e,
      ),
    );
  }

  return (
    <TaskTreeVisualization
      tasks={INITIAL_TASKS}
      edges={edges}
      onAddDependency={handleAdd}
      onRemoveDependency={handleRemove}
      onMoveDependency={handleMove}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DevTestTreePage() {
  return (
    <QueryClientProvider client={testQueryClient}>
      <OrgContext.Provider value={mockOrgCtx}>
        <TerminologyProvider>
          <WouterRouter>
            <div className="p-6 max-w-2xl mx-auto" data-testid="dev-test-tree-page">
              <h1 className="text-lg font-semibold mb-4 text-foreground">
                Dev: Task Tree Touch-Drag Fixture
              </h1>
              <p className="text-sm text-muted-foreground mb-4">
                Beta (TSK-2) starts as a child of Alpha (TSK-1). Gamma (TSK-3) is a root.
                Use touch drag to promote/demote tasks.
              </p>
              <ControlledTree />
            </div>
          </WouterRouter>
        </TerminologyProvider>
      </OrgContext.Provider>
    </QueryClientProvider>
  );
}
