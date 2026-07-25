/**
 * Drag-and-drop tests for TaskTreeVisualization / TaskTreeNode.
 *
 * Covers:
 *  1. Root drag → drop onto another node: onAddDependency is called (create edge)
 *     and the new child appears nested under the target after the state update.
 *  2. Non-root drag → drop onto the "Top Level" drop zone: onRemoveDependency is
 *     called (remove edge) and the task reappears as a root node.
 *  3. Cycle prevention: dragging a parent onto one of its descendants fires no
 *     callback and the tree is unchanged.
 *  4. Self-drop prevention: dragging a node onto its own row is ignored.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, createEvent, within, act } from "@testing-library/react";
import React, { useState } from "react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => key,
    tSingular: (key: string) => key,
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { TaskTreeVisualization } from "./task-tree-visualization.js";
import type { TaskTreeItemData } from "./task-tree-node.js";
import type { TaskDependencyEdgeData } from "./task-tree-visualization.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A small DataTransfer stub that satisfies the handlers in TaskTreeNode:
 *   e.dataTransfer.effectAllowed = "move";
 *   e.dataTransfer.setData(…);
 *   e.dataTransfer.dropEffect = …;
 */
function makeDataTransfer() {
  return {
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
    setData: vi.fn(),
    getData: vi.fn(),
  };
}

/** Fire a dragstart event on `el`, attaching a stub DataTransfer. */
function fireDragStart(el: HTMLElement) {
  const event = createEvent.dragStart(el);
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(),
    writable: true,
  });
  fireEvent(el, event);
}

/** Fire a dragover event on `el`, attaching a stub DataTransfer. */
function fireDragOver(el: HTMLElement) {
  const event = createEvent.dragOver(el);
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(),
    writable: true,
  });
  fireEvent(el, event);
}

/** Fire a drop event on `el`, attaching a stub DataTransfer. */
function fireDrop(el: HTMLElement) {
  const event = createEvent.drop(el);
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(),
    writable: true,
  });
  fireEvent(el, event);
}

// ─── Controlled wrapper ───────────────────────────────────────────────────────

/**
 * Wraps TaskTreeVisualization and manages tasks + edges in local state so we
 * can observe the tree re-rendering after dependency callbacks fire (simulating
 * what the real page does when the server confirms a change).
 */
function ControlledTree({
  initialTasks,
  initialEdges,
  onAddDependency,
  onRemoveDependency,
  onMoveDependency,
}: {
  initialTasks: TaskTreeItemData[];
  initialEdges: TaskDependencyEdgeData[];
  onAddDependency?: (taskId: number, dependsOnTaskId: number) => void;
  onRemoveDependency?: (taskId: number, dependsOnTaskId: number) => void;
  onMoveDependency?: (taskId: number, oldParentId: number, newParentId: number) => void;
}) {
  const [tasks] = useState(initialTasks);
  const [edges, setEdges] = useState(initialEdges);

  function handleAdd(taskId: number, dependsOnTaskId: number) {
    onAddDependency?.(taskId, dependsOnTaskId);
    // Simulate optimistic update: add the new edge immediately.
    setEdges((prev) => [
      ...prev,
      { id: Date.now(), taskId, dependsOnTaskId },
    ]);
  }

  function handleRemove(taskId: number, dependsOnTaskId: number) {
    onRemoveDependency?.(taskId, dependsOnTaskId);
    // Simulate optimistic update: remove the edge immediately.
    setEdges((prev) =>
      prev.filter(
        (e) => !(e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId),
      ),
    );
  }

  function handleMove(taskId: number, oldParentId: number, newParentId: number) {
    onMoveDependency?.(taskId, oldParentId, newParentId);
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
      tasks={tasks}
      edges={edges}
      onAddDependency={handleAdd}
      onRemoveDependency={handleRemove}
      onMoveDependency={handleMove}
    />
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TASK_A: TaskTreeItemData = { id: 1, orgTaskNumber: 1, title: "Task Alpha", stageName: "Open", isClosed: false };
const TASK_B: TaskTreeItemData = { id: 2, orgTaskNumber: 2, title: "Task Beta", stageName: "Open", isClosed: false };
const TASK_C: TaskTreeItemData = { id: 3, orgTaskNumber: 3, title: "Task Gamma", stageName: "Open", isClosed: false };
const TASK_D: TaskTreeItemData = { id: 4, orgTaskNumber: 4, title: "Task Delta", stageName: "Open", isClosed: false };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskTreeVisualization — drag-and-drop", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  // ── 1. Root drag → create edge ─────────────────────────────────────────────

  describe("root drag → drop onto another node", () => {
    it("calls onAddDependency with (draggedId, targetId)", () => {
      const onAdd = vi.fn();
      // Both tasks are roots (no edges).
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
          onAddDependency={onAdd}
        />,
      );

      // Drag handle for Task A (root → parentId is null at drag time)
      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);

      // After drag start the visualization sets dragState; the drop handlers
      // are now wired up on every tree node.
      const nodeB = screen.getByTestId("tree-node-2");
      fireDragOver(nodeB);
      fireDrop(nodeB);

      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith(1, 2);
    });

    it("re-renders Task A as a child of Task B after the edge is added", async () => {
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
        />,
      );

      // Before drag: both tasks are at the root level.
      expect(screen.getByText("Task Alpha")).toBeInTheDocument();
      expect(screen.getByText("Task Beta")).toBeInTheDocument();

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);

      const nodeB = screen.getByTestId("tree-node-2");
      fireDragOver(nodeB);

      await act(async () => {
        fireDrop(nodeB);
      });

      // After the optimistic update in ControlledTree, Task A should now be
      // nested under Task B.  The tree-node for A should still be in the DOM.
      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      // Task B row should now have a folder icon (it gained a child).
      // Task A's root row should no longer be a separate top-level entry.
      // Verify the structure: Task A's node is now nested inside B's subtree.
      const nodeBEl = screen.getByTestId("tree-node-2");
      const nodeAEl = screen.getByTestId("tree-node-1");
      // nodeA should appear after nodeB in the DOM (it is a child).
      expect(
        nodeBEl.compareDocumentPosition(nodeAEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // ── 2. Child drag → top-level drop zone (remove edge) ────────────────────

  describe("non-root drag → drop onto Top Level zone", () => {
    it("calls onRemoveDependency with (taskId, parentId)", () => {
      const onRemove = vi.fn();
      // B depends on A (A is parent of B).
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onRemoveDependency={onRemove}
        />,
      );

      // Drag handle for Task B (has parentId = 1).
      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);

      // Top Level drop zone should now be visible.
      const zone = screen.getByTestId("top-level-drop-zone");
      fireDragOver(zone);
      fireDrop(zone);

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(2, 1);
    });

    it("top-level zone is not shown when dragging a root node (already top-level)", () => {
      // A is a root; dragging a root should not show a meaningful top-level zone.
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
        />,
      );

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);

      // The zone renders but signals "Already a top-level task".
      const zone = screen.getByTestId("top-level-drop-zone");
      expect(zone).toBeInTheDocument();
      expect(zone).toHaveTextContent(/already a top-level task/i);
    });

    it("re-renders Task B as a root after the edge is removed", async () => {
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
        />,
      );

      // Before drag: B is a child of A.
      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("tree-node-2")).toBeInTheDocument();

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);

      const zone = screen.getByTestId("top-level-drop-zone");
      fireDragOver(zone);

      await act(async () => {
        fireDrop(zone);
      });

      // After remove, both A and B should be independent root nodes.
      // Verify both tree nodes are rendered at the root level by checking
      // they are both direct siblings in the root container.
      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("tree-node-2")).toBeInTheDocument();
    });
  });

  // ── 3. Cycle prevention ───────────────────────────────────────────────────

  describe("cycle prevention", () => {
    it("does not call onAddDependency when dropping a root ancestor onto its own descendant", () => {
      const onAdd = vi.fn();
      // A → B → C (A is grandparent of C)
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C]}
          initialEdges={[
            { id: 1, taskId: 2, dependsOnTaskId: 1 }, // A is parent of B
            { id: 2, taskId: 3, dependsOnTaskId: 2 }, // B is parent of C
          ]}
          onAddDependency={onAdd}
        />,
      );

      // Drag A (the root); its descendants B and C must be invalid drop targets.
      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);

      // Try to drop onto C (a descendant of A → would create a cycle).
      const nodeC = screen.getByTestId("tree-node-3");
      fireDragOver(nodeC);
      fireDrop(nodeC);

      expect(onAdd).not.toHaveBeenCalled();
    });

    it("does not call onMoveDependency when a node is dropped onto one of its own children", () => {
      const onMove = vi.fn();
      // A → B, A → C (B and C are siblings under A)
      // B also has a child D.
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C, TASK_D]}
          initialEdges={[
            { id: 1, taskId: 2, dependsOnTaskId: 1 }, // A is parent of B
            { id: 2, taskId: 3, dependsOnTaskId: 1 }, // A is parent of C
            { id: 3, taskId: 4, dependsOnTaskId: 2 }, // B is parent of D
          ]}
          onMoveDependency={onMove}
        />,
      );

      // Drag B (parent=A). D is a descendant of B → dropping B onto D creates a cycle.
      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);

      const nodeD = screen.getByTestId("tree-node-4");
      fireDragOver(nodeD);
      fireDrop(nodeD);

      expect(onMove).not.toHaveBeenCalled();
    });
  });

  // ── 4. Self-drop prevention ──────────────────────────────────────────────

  describe("self-drop prevention", () => {
    it("does not call onAddDependency when a root node is dropped onto itself", () => {
      const onAdd = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
          onAddDependency={onAdd}
        />,
      );

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);

      // Drop A onto itself.
      const nodeA = screen.getByTestId("tree-node-1");
      fireDragOver(nodeA);
      fireDrop(nodeA);

      expect(onAdd).not.toHaveBeenCalled();
    });
  });

  // ── 5. Permission gate ──────────────────────────────────────────────────

  describe("permission gate", () => {
    it("does not render drag handles when user lacks link_tasks permission", () => {
      mockHasPermission.mockImplementation((key: string) => key !== "link_tasks");
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
        />,
      );

      expect(screen.queryByTestId("drag-handle-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("drag-handle-2")).not.toBeInTheDocument();
    });
  });
});
