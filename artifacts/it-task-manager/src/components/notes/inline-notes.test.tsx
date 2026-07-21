/**
 * Tests for InlineNotes component.
 *
 * Covers: empty state, expanded footer Scratch Pad link, owner/read-only copy,
 * truncation wrapper, and delete confirmation dialog.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be defined before any vi.mock() calls
// ---------------------------------------------------------------------------

const mockNotes = vi.hoisted(() => ({ current: [] as any[] }));
const mockDeleteMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useListNotes: () => ({ data: mockNotes.current, refetch: vi.fn() }),
  useCreateNote: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
    isPending: false,
  }),
  useDeleteNote: () => ({ mutateAsync: mockDeleteMutateAsync }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ href, children, onClick, "aria-label": ariaLabel }: any) => (
    <a href={href} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/notes/markdown-preview", () => ({
  MarkdownPreview: ({ content }: any) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Static import — MUST come after all vi.mock() calls
// ---------------------------------------------------------------------------

import { InlineNotes } from "./inline-notes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_NOTE = {
  id: 42,
  title: "My Note",
  content: "Hello **world**",
  visibility: "private" as const,
  isOwner: true,
  projectId: null,
  taskId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PUBLIC_READ_NOTE = {
  ...OWNER_NOTE,
  id: 99,
  isOwner: false,
  visibility: "public_read" as const,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderInlineNotes(taskId = 1) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <InlineNotes taskId={taskId} />
    </QueryClientProvider>,
  );
}

/** Click the first accordion header row (the clickable note header). */
function clickFirstHeader() {
  const headers = document.querySelectorAll<HTMLElement>("[class*='cursor-pointer']");
  expect(headers.length).toBeGreaterThan(0);
  fireEvent.click(headers[0]);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockNotes.current = [];
  mockDeleteMutateAsync.mockReset();
  mockDeleteMutateAsync.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InlineNotes", () => {
  describe("empty state", () => {
    it("renders 'No notes yet.' when the list is empty", () => {
      mockNotes.current = [];
      renderInlineNotes();
      expect(screen.getByText("No notes yet.")).toBeInTheDocument();
    });
  });

  describe("expanded body — footer Scratch Pad link", () => {
    it("shows 'Edit full note in Scratch Pad' footer link for owner after expanding", () => {
      mockNotes.current = [OWNER_NOTE];
      renderInlineNotes();
      clickFirstHeader();

      const link = screen.getByText(/edit full note in scratch pad/i).closest("a");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", `/notes?note=${OWNER_NOTE.id}`);
    });

    it("shows 'View full note in Scratch Pad' footer link for public_read non-owner after expanding", () => {
      mockNotes.current = [PUBLIC_READ_NOTE];
      renderInlineNotes();
      clickFirstHeader();

      const link = screen.getByText(/view full note in scratch pad/i).closest("a");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", `/notes?note=${PUBLIC_READ_NOTE.id}`);
    });

    it("renders the truncation clamp wrapper after expanding", () => {
      mockNotes.current = [OWNER_NOTE];
      renderInlineNotes();
      clickFirstHeader();

      const clamp = screen.getByTestId("note-preview-clamp");
      expect(clamp).toBeInTheDocument();
      expect(clamp).toHaveClass("overflow-hidden");
    });
  });

  describe("delete confirmation dialog", () => {
    it("opens the AlertDialog when the trash icon button is clicked", () => {
      mockNotes.current = [OWNER_NOTE];
      renderInlineNotes();

      const deleteBtn = document.querySelector<HTMLElement>(
        "button[class*='hover\\:text-destructive']",
      );
      expect(deleteBtn).not.toBeNull();
      fireEvent.click(deleteBtn!);

      expect(screen.getByText("Delete note?")).toBeInTheDocument();
    });

    it("closes without calling deleteNote.mutateAsync when Cancel is clicked", async () => {
      mockNotes.current = [OWNER_NOTE];
      renderInlineNotes();

      const deleteBtn = document.querySelector<HTMLElement>(
        "button[class*='hover\\:text-destructive']",
      );
      fireEvent.click(deleteBtn!);

      expect(screen.getByText("Delete note?")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText("Delete note?")).not.toBeInTheDocument();
      });

      expect(mockDeleteMutateAsync).not.toHaveBeenCalled();
    });
  });
});
