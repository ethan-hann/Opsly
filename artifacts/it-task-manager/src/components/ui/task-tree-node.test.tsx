/**
 * Unit tests for TaskTreeNode component.
 *
 * Covers:
 *  - Renders task number and title
 *  - Shows Open/Closed badge based on isClosed
 *  - Focused node shows highlighted ring styling
 *  - Ancestor node shows subtle highlight
 *  - Remove (×) button shown with link_tasks; hidden without it
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

import { TaskTreeNode } from "./task-tree-node.js";
import type { TaskTreeItemData } from "./task-tree-node.js";

const OPEN_TASK: TaskTreeItemData = {
  id: 10,
  orgTaskNumber: 42,
  title: "Fix the bug",
  stageName: "InProgress",
  isClosed: false,
};

const CLOSED_TASK: TaskTreeItemData = {
  id: 11,
  orgTaskNumber: 43,
  title: "Deploy the fix",
  stageName: "Done",
  isClosed: true,
};

function renderNode(
  task: TaskTreeItemData,
  opts: {
    isFocused?: boolean;
    isAncestor?: boolean;
    onRemoveDependency?: (parentId: number, depId: number) => void;
  } = {},
) {
  const childrenMap = new Map<number, number[]>();
  const allItems = new Map<number, TaskTreeItemData>();
  allItems.set(task.id, task);

  return render(
    <div>
      <TaskTreeNode
        item={task}
        children={[]}
        childrenMap={childrenMap}
        allItems={allItems}
        depth={0}
        isFocused={opts.isFocused ?? false}
        isAncestor={opts.isAncestor ?? false}
        onRemoveDependency={opts.onRemoveDependency}
      />
    </div>,
  );
}

describe("TaskTreeNode", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(true);
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  it("renders the task number and title", () => {
    renderNode(OPEN_TASK);
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
  });

  it("shows the stage name badge for a non-closed task", () => {
    renderNode(OPEN_TASK);
    expect(screen.getByText("InProgress")).toBeInTheDocument();
  });

  it("shows the Done badge for a closed task", () => {
    renderNode(CLOSED_TASK);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("does not render × remove button when onRemoveDependency is not provided", () => {
    renderNode(OPEN_TASK);
    // No remove callback = no × button
    const btns = screen.queryAllByRole("button");
    expect(btns.every((b) => !b.textContent?.includes("×"))).toBe(true);
  });

  it("does not render × remove button when user lacks link_tasks permission", () => {
    mockHasPermission.mockImplementation((key: string) => key !== "link_tasks");
    renderNode(OPEN_TASK, { onRemoveDependency: vi.fn() });
    const btns = screen.queryAllByRole("button");
    expect(btns.every((b) => !b.textContent?.includes("×"))).toBe(true);
  });

  it("applies isFocused styling when isFocused=true", () => {
    const { container } = renderNode(OPEN_TASK, { isFocused: true });
    // The focused node should have ring/highlight class
    expect(container.innerHTML).toMatch(/ring-2|font-semibold|bg-primary/);
  });

  it("applies ancestor styling when isAncestor=true and not focused", () => {
    const { container } = renderNode(OPEN_TASK, { isAncestor: true });
    expect(container.innerHTML).toMatch(/bg-muted/);
  });
});
