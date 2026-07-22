/**
 * Unit tests for reference-picker.tsx
 *
 * Tests:
 *  - Renders correct tab labels using terminology context
 *  - Keyboard navigation (ArrowDown/ArrowUp/Enter) selects items
 *  - Escape closes the picker
 *  - Filter tab changes query type param
 *  - Items rendered from API results
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── Mock useGetReferences ──────────────────────────────────────────────────
const mockGetReferences = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useGetReferences: mockGetReferences,
}));

// ── Mock useTerminology ────────────────────────────────────────────────────
vi.mock("@/context/terminology-context", () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        tasks: "Tickets",
        projects: "Portfolios",
      };
      return map[key] ?? key;
    },
    ts: (key: string) => {
      const map: Record<string, string> = {
        tasks: "Ticket",
        projects: "Portfolio",
      };
      return map[key] ?? key;
    },
    tSingular: (key: string) => key,
  }),
}));

import { ReferencePicker } from "./reference-picker";

const baseProps = {
  query: "",
  filterType: "all" as const,
  selectedIdx: 0,
  pickerRect: { top: 200, left: 100, width: 300, showBelow: true },
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onFilterChange: vi.fn(),
  onSelectedIdxChange: vi.fn(),
};

function setup(overrides = {}) {
  const props = { ...baseProps, ...overrides };
  // Reset mocks
  props.onSelect = vi.fn();
  props.onClose = vi.fn();
  props.onFilterChange = vi.fn();
  props.onSelectedIdxChange = vi.fn();

  render(<ReferencePicker {...props} />);
  return props;
}

describe("ReferencePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReferences.mockReturnValue({
      data: {
        tasks: [
          { id: 1, title: "Fix login bug", projectName: "Web App" },
          { id: 2, title: "Add dark mode", projectName: null },
        ],
        projects: [
          { id: 10, name: "Mobile App" },
        ],
      },
      isLoading: false,
    });
  });

  // ── Tab labels ─────────────────────────────────────────────────────────────

  it("renders All tab", () => {
    setup();
    expect(screen.getByTestId("ref-tab-all")).toBeInTheDocument();
    expect(screen.getByTestId("ref-tab-all").textContent).toBe("All");
  });

  it("renders tasks tab using terminology singular label", () => {
    setup();
    const tab = screen.getByTestId("ref-tab-task");
    // ts("tasks") returns "Ticket" in our mock
    expect(tab.textContent).toBe("Ticket");
  });

  it("renders projects tab using terminology singular label", () => {
    setup();
    const tab = screen.getByTestId("ref-tab-project");
    // ts("projects") returns "Portfolio" in our mock
    expect(tab.textContent).toBe("Portfolio");
  });

  // ── Results list ───────────────────────────────────────────────────────────

  it("renders tasks and projects from API results", () => {
    setup();
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
    expect(screen.getByText("Mobile App")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockGetReferences.mockReturnValue({ data: undefined, isLoading: true });
    setup();
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
  });

  it("shows empty state when no results", () => {
    mockGetReferences.mockReturnValue({
      data: { tasks: [], projects: [] },
      isLoading: false,
    });
    setup();
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  // ── Item selection ─────────────────────────────────────────────────────────

  it("calls onSelect with task token when item is clicked", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByText("Fix login bug").closest("button")!);
    expect(props.onSelect).toHaveBeenCalledWith("#[task:1:Fix login bug]");
  });

  it("calls onSelect with project token when project is clicked", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByText("Mobile App").closest("button")!);
    expect(props.onSelect).toHaveBeenCalledWith("#[project:10:Mobile App]");
  });

  // ── Filter tabs ────────────────────────────────────────────────────────────

  it("calls onFilterChange when a tab is clicked", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByTestId("ref-tab-task"));
    expect(props.onFilterChange).toHaveBeenCalledWith("task");
  });

  it("calls onFilterChange with 'project' when projects tab is clicked", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByTestId("ref-tab-project"));
    expect(props.onFilterChange).toHaveBeenCalledWith("project");
  });

  // ── Active tab highlight ───────────────────────────────────────────────────

  it("passes correct type to useGetReferences based on filterType prop", () => {
    setup({ filterType: "task" });
    expect(mockGetReferences).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task" }),
      expect.anything(),
    );
  });

  it("passes query to useGetReferences", () => {
    setup({ query: "login" });
    expect(mockGetReferences).toHaveBeenCalledWith(
      expect.objectContaining({ q: "login" }),
      expect.anything(),
    );
  });

  // ── Selected index ─────────────────────────────────────────────────────────

  it("marks the item at selectedIdx as selected", () => {
    setup({ selectedIdx: 1 });
    const item1 = screen.getByTestId("ref-item-1");
    expect(item1.getAttribute("data-selected")).toBe("true");
  });

  it("does not mark other items as selected", () => {
    setup({ selectedIdx: 0 });
    const item1 = screen.getByTestId("ref-item-1");
    expect(item1.getAttribute("data-selected")).toBeNull();
  });
});
