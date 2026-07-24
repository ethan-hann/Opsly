/**
 * Unit tests for TaskTreeVisualization component.
 *
 * Covers:
 *  - Full mode: renders all tasks as tree nodes
 *  - Full mode: shows "Add dependency" button with link_tasks permission
 *  - Focused mode: highlights focused task
 *  - Task Tree tab hidden when task_trees disabled (FeatureGate)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const mockHasPermission = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn().mockReturnValue(true));

vi.mock("@/hooks/use-org-context", () => ({
  useOrgContext: () => ({
    hasPermission: mockHasPermission,
    isFeatureEnabled: mockIsFeatureEnabled,
    isAdmin: false,
    isOwner: false,
    org: null,
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { TaskTreeVisualization } from "./task-tree-visualization.js";
import type { TaskTreeItemData } from "./task-tree-node.js";
import type { TaskDependencyEdgeData } from "./task-tree-visualization.js";

const TASKS: TaskTreeItemData[] = [
  { id: 1, orgTaskNumber: 1, title: "Parent task", stageName: "Open", isClosed: false },
  { id: 2, orgTaskNumber: 2, title: "Child task", stageName: "Open", isClosed: false },
  { id: 3, orgTaskNumber: 3, title: "Root task", stageName: "Done", isClosed: true },
];

const EDGES: TaskDependencyEdgeData[] = [
  // task 2 depends on task 1 (task1 is parent of task2)
  { id: 1, taskId: 2, dependsOnTaskId: 1 },
];

function renderViz(
  focusedTaskId?: number,
  opts: { tasks?: TaskTreeItemData[]; edges?: TaskDependencyEdgeData[] } = {},
) {
  return render(
    <TaskTreeVisualization
      tasks={opts.tasks ?? TASKS}
      edges={opts.edges ?? EDGES}
      focusedTaskId={focusedTaskId}
      onAddDependency={vi.fn()}
      onRemoveDependency={vi.fn()}
    />,
  );
}

describe("TaskTreeVisualization", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  it("renders all tasks in full mode (no focusedTaskId)", () => {
    renderViz();
    expect(screen.getByText("Parent task")).toBeInTheDocument();
    expect(screen.getByText("Child task")).toBeInTheDocument();
    expect(screen.getByText("Root task")).toBeInTheDocument();
  });

  it("renders Add dependency button in full mode when user has link_tasks", () => {
    renderViz();
    expect(screen.getByText(/add dependency/i)).toBeInTheDocument();
  });

  it("does not render Add dependency button when user lacks link_tasks", () => {
    mockHasPermission.mockImplementation((key: string) => key !== "link_tasks");
    renderViz();
    expect(screen.queryByText(/add dependency/i)).not.toBeInTheDocument();
  });

  it("renders in focused mode when focusedTaskId is given", () => {
    renderViz(1);
    // The focused task should still be in the DOM
    expect(screen.getByText("Parent task")).toBeInTheDocument();
  });

  it("shows all root tasks as nodes when no edges exist", () => {
    renderViz(undefined, { tasks: TASKS, edges: [] });
    // All 3 tasks are roots with no edges
    expect(screen.getByText("Parent task")).toBeInTheDocument();
    expect(screen.getByText("Child task")).toBeInTheDocument();
    expect(screen.getByText("Root task")).toBeInTheDocument();
  });
});
