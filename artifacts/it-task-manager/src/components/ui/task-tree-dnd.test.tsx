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
 *  5. Permission gate: drag handles hidden when user lacks link_tasks.
 *  6. Re-parenting (task #476): dragging a child from one parent to another
 *     calls onMoveDependency and updates the tree without a page refresh.
 *  7. Touch-drag → root (task #477): touchstart + touchend on the top-level
 *     zone calls onRemoveDependency and re-renders the task as a root.
 *  8. Firefox dragEnd-before-drop (task #478): dragEnd fires before drop but the
 *     top-level zone stays visible until the drop resolves (deferred clear).
 *
 * Timer note: onDragStart defers the dragState update via setTimeout(0) so that
 * the React re-render does not cancel the browser's drag gesture.  Tests must
 * therefore flush timers with `act(() => vi.runAllTimers())` after fireDragStart.
 * vi.useFakeTimers() / vi.useRealTimers() are managed per-suite via beforeEach /
 * afterEach so the timer isolation is tight.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, createEvent, act } from "@testing-library/react";
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

function makeDataTransfer() {
  return {
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
    setData: vi.fn(),
    getData: vi.fn(),
  };
}

function fireDragStart(el: HTMLElement) {
  const event = createEvent.dragStart(el);
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(), writable: true });
  fireEvent(el, event);
}

function fireDragOver(el: HTMLElement) {
  const event = createEvent.dragOver(el);
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(), writable: true });
  fireEvent(el, event);
}

function fireDragEnd(el: HTMLElement) {
  fireEvent.dragEnd(el);
}

function fireDrop(el: HTMLElement) {
  const event = createEvent.drop(el);
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(), writable: true });
  fireEvent(el, event);
}

/**
 * Flush the deferred dragState update that onDragStart schedules via
 * setTimeout(0).  Must be called inside act() so React processes the state
 * change before assertions run.
 */
function flushDragStart() {
  act(() => { vi.runAllTimers(); });
}

// ─── Controlled wrapper ───────────────────────────────────────────────────────

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
    setEdges((prev) => [...prev, { id: Date.now(), taskId, dependsOnTaskId }]);
  }

  function handleRemove(taskId: number, dependsOnTaskId: number) {
    onRemoveDependency?.(taskId, dependsOnTaskId);
    setEdges((prev) =>
      prev.filter((e) => !(e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId)),
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
const TASK_B: TaskTreeItemData = { id: 2, orgTaskNumber: 2, title: "Task Beta",  stageName: "Open", isClosed: false };
const TASK_C: TaskTreeItemData = { id: 3, orgTaskNumber: 3, title: "Task Gamma", stageName: "Open", isClosed: false };
const TASK_D: TaskTreeItemData = { id: 4, orgTaskNumber: 4, title: "Task Delta", stageName: "Open", isClosed: false };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskTreeVisualization — drag-and-drop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Root drag → create edge ─────────────────────────────────────────────

  describe("root drag → drop onto another node", () => {
    it("calls onAddDependency with (draggedId, targetId)", () => {
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
      flushDragStart();

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

      expect(screen.getByText("Task Alpha")).toBeInTheDocument();
      expect(screen.getByText("Task Beta")).toBeInTheDocument();

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);
      flushDragStart();

      const nodeB = screen.getByTestId("tree-node-2");
      fireDragOver(nodeB);

      await act(async () => { fireDrop(nodeB); });

      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      const nodeBEl = screen.getByTestId("tree-node-2");
      const nodeAEl = screen.getByTestId("tree-node-1");
      expect(
        nodeBEl.compareDocumentPosition(nodeAEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // ── 2. Child drag → top-level drop zone (remove edge) ────────────────────

  describe("non-root drag → drop onto Top Level zone", () => {
    it("calls onRemoveDependency with (taskId, parentId)", () => {
      const onRemove = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onRemoveDependency={onRemove}
        />,
      );

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      const zone = screen.getByTestId("top-level-drop-zone");
      fireDragOver(zone);
      fireDrop(zone);

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(2, 1);
    });

    it("top-level zone is not shown when dragging a root node (already top-level)", () => {
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[]}
        />,
      );

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);
      flushDragStart();

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

      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("tree-node-2")).toBeInTheDocument();

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      const zone = screen.getByTestId("top-level-drop-zone");
      fireDragOver(zone);

      await act(async () => { fireDrop(zone); });

      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("tree-node-2")).toBeInTheDocument();
    });
  });

  // ── 3. Cycle prevention ───────────────────────────────────────────────────

  describe("cycle prevention", () => {
    it("does not call onAddDependency when dropping a root ancestor onto its own descendant", () => {
      const onAdd = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C]}
          initialEdges={[
            { id: 1, taskId: 2, dependsOnTaskId: 1 },
            { id: 2, taskId: 3, dependsOnTaskId: 2 },
          ]}
          onAddDependency={onAdd}
        />,
      );

      const handleA = screen.getByTestId("drag-handle-1");
      fireDragStart(handleA);
      flushDragStart();

      const nodeC = screen.getByTestId("tree-node-3");
      fireDragOver(nodeC);
      fireDrop(nodeC);

      expect(onAdd).not.toHaveBeenCalled();
    });

    it("does not call onMoveDependency when a node is dropped onto one of its own children", () => {
      const onMove = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C, TASK_D]}
          initialEdges={[
            { id: 1, taskId: 2, dependsOnTaskId: 1 },
            { id: 2, taskId: 3, dependsOnTaskId: 1 },
            { id: 3, taskId: 4, dependsOnTaskId: 2 },
          ]}
          onMoveDependency={onMove}
        />,
      );

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

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
      flushDragStart();

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

  // ── 6. Re-parenting (task #476) ──────────────────────────────────────────
  //
  // A child task dragged from its current parent and dropped onto a different
  // parent node must:
  //   a) call onMoveDependency(taskId, oldParentId, newParentId)
  //   b) reflect the new position in the tree immediately (no page refresh)

  describe("re-parenting a child to a different parent (task #476)", () => {
    it("calls onMoveDependency(childId, oldParentId, newParentId) when dropped on a new parent", () => {
      const onMove = vi.fn();
      // Tree: A→B (B is a child of A), C is a root.
      // We will re-parent B from A to C.
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onMoveDependency={onMove}
        />,
      );

      // B has parentId = 1 (A) at drag time.
      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      // Drop onto C (tree-node-3), which is a valid new parent.
      const nodeC = screen.getByTestId("tree-node-3");
      fireDragOver(nodeC);
      fireDrop(nodeC);

      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove).toHaveBeenCalledWith(2, 1, 3);
    });

    it("does not call onMoveDependency when dropped back onto the current parent (no-op)", () => {
      const onMove = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onMoveDependency={onMove}
        />,
      );

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      // Drop B back onto A — the current parent is in the invalid-drop set.
      const nodeA = screen.getByTestId("tree-node-1");
      fireDragOver(nodeA);
      fireDrop(nodeA);

      expect(onMove).not.toHaveBeenCalled();
    });

    it("reflects the re-parenting in the tree without a page refresh", async () => {
      // Tree: A→B (B is a child of A), C is a root.
      // After re-parenting B→C: B should appear under C, not under A.
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B, TASK_C]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
        />,
      );

      // Before: B (tree-node-2) follows A (tree-node-1) in DOM.
      const nodeBBefore = screen.getByTestId("tree-node-2");
      const nodeAEl = screen.getByTestId("tree-node-1");
      expect(
        nodeAEl.compareDocumentPosition(nodeBBefore) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      const nodeC = screen.getByTestId("tree-node-3");
      fireDragOver(nodeC);
      await act(async () => { fireDrop(nodeC); });

      // After optimistic update: B (tree-node-2) should follow C (tree-node-3)
      // in the DOM, meaning it is now nested under C.
      const nodeCEl = screen.getByTestId("tree-node-3");
      const nodeBAfter = screen.getByTestId("tree-node-2");
      expect(
        nodeCEl.compareDocumentPosition(nodeBAfter) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  // ── 7. Touch-drag → root (task #477) ──────────────────────────────────────
  //
  // On touch devices the drag is initiated by onTouchStart (which sets dragState
  // synchronously — no setTimeout) and resolved by a native touchend listener on
  // the container.  The listener calls document.elementFromPoint to identify the
  // drop target.  We mock elementFromPoint so JSDOM can resolve it.

  describe("touch-drag promotes a child task to root (task #477)", () => {
    it("shows the top-level drop zone after touchstart on a non-root drag handle", () => {
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
        />,
      );

      // Before touch: no drag → zone is not rendered.
      expect(screen.queryByTestId("top-level-drop-zone")).not.toBeInTheDocument();

      const handleB = screen.getByTestId("drag-handle-2");
      fireEvent.touchStart(handleB);

      // dragState is now set → zone should appear.
      expect(screen.getByTestId("top-level-drop-zone")).toBeInTheDocument();
    });

    it("calls onRemoveDependency and re-renders task as root when touch ends on the drop zone", async () => {
      const onRemove = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onRemoveDependency={onRemove}
        />,
      );

      // Initiate touch drag on B's handle (sets dragState synchronously).
      const handleB = screen.getByTestId("drag-handle-2");
      fireEvent.touchStart(handleB);

      // The top-level drop zone is now visible.
      const zone = screen.getByTestId("top-level-drop-zone");

      // JSDOM does not implement elementFromPoint, so we define it directly.
      // The container's native touchend handler calls it to resolve the drop target.
      const original = document.elementFromPoint;
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        writable: true,
        value: () => zone,
      });

      const container = zone.closest(".space-y-2") as HTMLElement;
      await act(async () => {
        fireEvent.touchEnd(container, {
          changedTouches: [{ clientX: 100, clientY: 200 }],
        });
      });

      // Restore original (undefined in JSDOM; just delete the override).
      if (original === undefined) {
        // @ts-expect-error — restoring to JSDOM's native undefined state
        delete document.elementFromPoint;
      } else {
        document.elementFromPoint = original;
      }

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(2, 1);

      // After the optimistic remove both A and B are root nodes.
      expect(screen.getByTestId("tree-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("tree-node-2")).toBeInTheDocument();
    });
  });

  // ── 8. Firefox dragEnd-before-drop (task #478) ────────────────────────────
  //
  // Firefox fires dragend before drop on the drop target.  Without the deferred
  // clear, onDragEnd would call setDragState(null) immediately, unmounting the
  // TopLevelDropZone before the drop event fires.  The fix (setTimeout(0) in
  // onDragEnd) queues the clear after the drop, so the zone stays alive long
  // enough to accept the drop.

  describe("drop zone stays visible until drop resolves — Firefox dragEnd-before-drop (task #478)", () => {
    it("top-level zone remains in the DOM after dragEnd fires but before timers flush", () => {
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
        />,
      );

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      // Zone is visible once drag starts.
      const zone = screen.getByTestId("top-level-drop-zone");
      expect(zone).toBeInTheDocument();

      // Firefox fires dragEnd before drop on the drop target.
      // Without the deferred clear the zone would vanish here.
      fireDragEnd(handleB);

      // Timer has NOT been flushed yet — zone must still be present so the
      // pending drop can still land on it.
      expect(screen.getByTestId("top-level-drop-zone")).toBeInTheDocument();
    });

    it("calls onRemoveDependency when drop fires after dragEnd (Firefox order)", () => {
      const onRemove = vi.fn();
      render(
        <ControlledTree
          initialTasks={[TASK_A, TASK_B]}
          initialEdges={[{ id: 1, taskId: 2, dependsOnTaskId: 1 }]}
          onRemoveDependency={onRemove}
        />,
      );

      const handleB = screen.getByTestId("drag-handle-2");
      fireDragStart(handleB);
      flushDragStart();

      const zone = screen.getByTestId("top-level-drop-zone");

      // Simulate Firefox event order: dragend fires first, then drop.
      fireDragEnd(handleB);   // queues a deferred clear — zone still visible
      fireDragOver(zone);
      fireDrop(zone);         // drop resolves before the deferred clear runs

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(2, 1);

      // Now flush the deferred clear — zone should disappear.
      act(() => { vi.runAllTimers(); });
      expect(screen.queryByTestId("top-level-drop-zone")).not.toBeInTheDocument();
    });
  });
});
