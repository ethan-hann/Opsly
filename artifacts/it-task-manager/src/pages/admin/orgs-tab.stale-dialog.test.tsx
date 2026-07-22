/**
 * AdminOrgsTab — suspend and delete dialogs stay fresh when the org list refreshes.
 *
 * Confirms two behaviours that come from storing only the org ID in state
 * and deriving the current org snapshot from the live query data:
 *
 *   1. If the org's data changes while the dialog is open (e.g. name updated
 *      by another admin), the dialog reflects the new values rather than the
 *      stale snapshot that was captured when the dialog was opened.
 *
 *   2. If the org is removed from the list while the dialog is open, the
 *      dialog closes automatically rather than dangling with stale content.
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mutable query data — mutated per-test to simulate a live refresh ──────────

const mockOrgsData = vi.hoisted(() => ({
  current: [] as {
    id: string; name: string; isDisabled: boolean;
    createdAt: string; memberCount: number; taskCount: number;
  }[],
}));

const mockMutate = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  // useQuery reads mockOrgsData.current on every render, so a rerender after
  // mutating it simulates what happens when a background query refetch arrives.
  useQuery:       () => ({ data: mockOrgsData.current, isLoading: false, refetch: vi.fn() }),
  useMutation:    () => ({ mutate: mockMutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t:    (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// AlertDialog mock that threads onOpenChange through context so AlertDialogCancel
// behaves like the real Radix implementation.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<((open: boolean) => void) | undefined>(undefined);

  return {
    AlertDialog: ({ open, onOpenChange, children }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) =>
      open ? (
        <Ctx.Provider value={onOpenChange}>
          <div data-testid="alert-dialog">{children}</div>
        </Ctx.Provider>
      ) : null,

    AlertDialogContent:     ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogHeader:      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogTitle:       ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogFooter:      ({ children }: { children: React.ReactNode }) => <div>{children}</div>,

    AlertDialogCancel: ({ children }: { children: React.ReactNode }) => {
      const onOpenChange = React.useContext(Ctx);
      return (
        <button data-testid="dialog-cancel" onClick={() => onOpenChange?.(false)}>
          {children}
        </button>
      );
    },

    AlertDialogAction: ({
      children, onClick, disabled,
    }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button data-testid="dialog-confirm" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_ORG = {
  id:          "org-1",
  name:        "Acme Corp",
  isDisabled:  false,
  createdAt:   "2024-01-15T00:00:00.000Z",
  memberCount: 5,
  taskCount:   12,
};

// ── Subject ───────────────────────────────────────────────────────────────────

import { AdminOrgsTab } from "./orgs-tab.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

// Helper: find the trash button (icon-only, no text content).
function getTrashButton() {
  return screen.getAllByRole("button").find((btn) => !btn.textContent?.trim())!;
}

describe("AdminOrgsTab — suspend dialog stays fresh on query refresh", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    // Reset to a single active org before each test.
    mockOrgsData.current = [{ ...BASE_ORG }];
  });

  it("reflects the latest org name after the query refreshes while the dialog is open", () => {
    const { rerender } = render(<AdminOrgsTab />);

    // Open the suspend dialog for "Acme Corp".
    fireEvent.click(screen.getByText("admin.orgs.suspend"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // Simulate a background query refresh: the org has been renamed.
    mockOrgsData.current = [{ ...BASE_ORG, name: "Acme Corp Renamed" }];
    rerender(<AdminOrgsTab />);

    // Dialog must still be open — the org still exists in the list.
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // The org row now shows the updated name, confirming the component
    // reads live data rather than the snapshot captured at dialog-open time.
    expect(screen.getByText("Acme Corp Renamed")).toBeInTheDocument();
  });

  it("closes automatically when the org is removed from the list while the dialog is open", () => {
    const { rerender } = render(<AdminOrgsTab />);

    // Open the suspend dialog.
    fireEvent.click(screen.getByText("admin.orgs.suspend"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // Simulate a refresh in which the org has been deleted by another admin.
    mockOrgsData.current = [];
    rerender(<AdminOrgsTab />);

    // The derived confirmSuspend becomes null → open={false} → dialog disappears.
    expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument();
  });
});

describe("AdminOrgsTab — delete dialog stays fresh on query refresh", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockOrgsData.current = [{ ...BASE_ORG }];
  });

  it("reflects the latest org name after the query refreshes while the dialog is open", () => {
    const { rerender } = render(<AdminOrgsTab />);

    // Open the delete dialog via the trash button (icon-only, no text).
    fireEvent.click(getTrashButton());
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // Simulate a background query refresh: the org has been renamed.
    mockOrgsData.current = [{ ...BASE_ORG, name: "Acme Corp Renamed" }];
    rerender(<AdminOrgsTab />);

    // Dialog must still be open — the org still exists in the list.
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // The org row now shows the updated name, confirming live data is used.
    expect(screen.getByText("Acme Corp Renamed")).toBeInTheDocument();
  });

  it("closes automatically when the org is removed from the list while the dialog is open", () => {
    const { rerender } = render(<AdminOrgsTab />);

    // Open the delete dialog.
    fireEvent.click(getTrashButton());
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();

    // Simulate a refresh in which the org has already been deleted.
    mockOrgsData.current = [];
    rerender(<AdminOrgsTab />);

    // confirmDeleteOrg becomes null → open={false} → dialog closes automatically.
    expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument();
  });

  it("calls deleteMutation with the live org id when Confirm is clicked", () => {
    render(<AdminOrgsTab />);

    fireEvent.click(getTrashButton());
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith("org-1");
  });
});
