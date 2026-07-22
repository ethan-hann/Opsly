/**
 * Notes sidebar — task filter auto-reset on project change.
 *
 * Verifies the useEffect in NotesPage that resets filterTaskId when the
 * project filter changes and the selected task no longer belongs to the
 * new project.
 *
 * Interaction strategy: the sidebar's SearchableSelect uses Popover + Command
 * from Radix UI.  These are mocked so their content is always rendered inline,
 * making CommandItems directly clickable without opening a real popover.
 */

import * as React from "react";
import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ALPHA = { id: 1, name: "Project Alpha" };
const PROJECT_BETA  = { id: 2, name: "Project Beta" };

/** Task A lives in Project Alpha only. */
const TASK_ALPHA = {
  id: 10, title: "Task Alpha", projectId: 1,
  orgId: "o1", orgTaskNumber: 1, status: "1", priority: "medium",
  stageType: "open", stageName: "Open", stageColor: null, stageArchived: false,
  dueDate: null, slaBreachedAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

/** Task B lives in Project Beta only. */
const TASK_BETA = {
  id: 20, title: "Task Beta",  projectId: 2,
  orgId: "o1", orgTaskNumber: 2, status: "1", priority: "medium",
  stageType: "open", stageName: "Open", stageColor: null, stageArchived: false,
  dueDate: null, slaBreachedAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListNotes:       () => ({ data: [], refetch: vi.fn() }),
  useCreateNote:      () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateNote:      () => ({ mutateAsync: vi.fn() }),
  useDeleteNote:      () => ({ mutateAsync: vi.fn() }),
  useListProjects:    () => ({ data: [PROJECT_ALPHA, PROJECT_BETA] }),
  useListTasks:       () => ({ data: [TASK_ALPHA, TASK_BETA] }),
  useListOrgMembers:  () => ({ data: [] }),
}));

vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/notes", vi.fn()],
}));

vi.mock("@/hooks/use-mobile",      () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast",       () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-draft-notes", () => ({
  useDraftNotes: () => ({
    drafts: [], createDraft: vi.fn(), updateDraft: vi.fn(), deleteDraft: vi.fn(),
  }),
}));

// Return translation keys verbatim so we can assert on stable strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Always-visible Popover: content renders inline, no portal, no show/hide.
vi.mock("@/components/ui/popover", () => ({
  Popover:        ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Thin Command wrappers: CommandItem calls onSelect() when clicked.
vi.mock("@/components/ui/command", () => ({
  Command:      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: () => null,
  CommandList:  ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CommandItem:  ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
}));

// Stub heavy sub-components — none affect the filter state under test.
vi.mock("@/components/notes/markdown-editor",  () => ({ MarkdownEditor: () => null }));
vi.mock("@/components/notes/markdown-preview", () => ({ MarkdownPreview: () => null }));
vi.mock("@/components/notes/note-card",        () => ({ NoteCard: () => null }));

// AlertDialogs are never open (no note is selected / deleted).
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog:            ({ open, children }: { open: boolean; children: React.ReactNode }) =>
                            open ? <div>{children}</div> : null,
  AlertDialogContent:     ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader:      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle:       ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter:      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel:      ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogAction:      ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import NotesPage from "./notes.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the two sidebar filter combobox trigger buttons.
 * The sidebar always has exactly two when no note is open:
 *   [0] = project filter   [1] = task filter
 */
function sidebarComboboxes() {
  return screen.getAllByRole("combobox");
}

/**
 * Click the option whose visible label matches `label` inside the always-open
 * dropdown menus.  The trigger itself has role="combobox" so getByRole("button")
 * only finds the thin CommandItem wrapper buttons — no ambiguity.
 */
function selectOption(label: string | RegExp) {
  // getAllByRole("button") skips role="combobox" triggers, returning only the
  // CommandItem buttons rendered by our Command mock.
  const items = screen.getAllByRole("button").filter((btn) => {
    const text = btn.textContent ?? "";
    return typeof label === "string" ? text.includes(label) : label.test(text);
  });
  // Click the first match (there should be exactly one per unique option label).
  fireEvent.click(items[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Notes sidebar — task filter resets when project changes", () => {
  it("resets the task filter when the new project does not contain the selected task", async () => {
    render(<NotesPage />);

    // Both filter comboboxes start showing their "all" placeholder.
    const [projCombo, taskCombo] = sidebarComboboxes();
    expect(projCombo).toHaveTextContent("notes.allProjects");
    expect(taskCombo).toHaveTextContent("notes.allTasks");

    // Step 1: select Project Alpha (id: 1).
    // filteredTasksForSidebar narrows to [Task Alpha].
    selectOption("Project Alpha");
    await waitFor(() =>
      expect(sidebarComboboxes()[0]).toHaveTextContent("Project Alpha"),
    );

    // Step 2: select Task Alpha (id: 10, which lives in Project Alpha).
    selectOption("Task Alpha");
    await waitFor(() =>
      expect(sidebarComboboxes()[1]).toHaveTextContent("Task Alpha"),
    );

    // Step 3: switch to Project Beta (id: 2).
    // Task Alpha (projectId: 1) does NOT belong to Project Beta.
    // The useEffect must reset filterTaskId → "all".
    selectOption("Project Beta");
    await waitFor(() => {
      expect(sidebarComboboxes()[0]).toHaveTextContent("Project Beta");
      // Task filter must revert to the "all tasks" placeholder.
      expect(sidebarComboboxes()[1]).toHaveTextContent("notes.allTasks");
      expect(sidebarComboboxes()[1]).not.toHaveTextContent("Task Alpha");
    });
  });

  it("does NOT reset the task filter when the selected task belongs to the new project", async () => {
    render(<NotesPage />);

    // Project filter is still "all", so filteredTasksForSidebar = all tasks.
    // Select Task Beta (id: 20, projectId: 2) while project filter is "all".
    // The useEffect early-returns when filterProjectId is "all", so no reset.
    selectOption("Task Beta");
    await waitFor(() =>
      expect(sidebarComboboxes()[1]).toHaveTextContent("Task Beta"),
    );

    // Now switch to Project Beta (id: 2), which CONTAINS Task Beta.
    // The useEffect fires: task 20 IS in project 2 → no reset.
    selectOption("Project Beta");
    await waitFor(() =>
      expect(sidebarComboboxes()[0]).toHaveTextContent("Project Beta"),
    );

    // Task filter must remain "Task Beta" — it was not cleared.
    expect(sidebarComboboxes()[1]).toHaveTextContent("Task Beta");
    expect(sidebarComboboxes()[1]).not.toHaveTextContent("notes.allTasks");
  });
});
