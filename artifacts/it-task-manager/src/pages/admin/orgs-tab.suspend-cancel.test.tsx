/**
 * AdminOrgsTab — suspend-dialog Cancel path.
 *
 * Confirms that clicking Cancel on the suspend confirmation dialog:
 *   - closes the dialog without calling the toggle mutation
 *   - leaves the org's status unchanged (still shown as Active)
 *
 * The AlertDialog mock threads onOpenChange through React context so that the
 * Cancel button can call onOpenChange(false) exactly as Radix UI does, without
 * needing a real Radix environment.
 */

import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Hoisted spy — shared by both useMutation calls (toggle + delete) ──────────

const mockMutate = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery:       () => ({ data: [MOCK_ORG], isLoading: false, refetch: vi.fn() }),
  useMutation:    () => ({ mutate: mockMutate, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t:    (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// AlertDialog mock that threads onOpenChange through context so the Cancel
// button behaves as it would in a real Radix environment.
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

    // Cancel: calls onOpenChange(false) via context, mirroring Radix behavior.
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
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button data-testid="dialog-confirm" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

const MOCK_ORG = {
  id:          "org-1",
  name:        "Acme Corp",
  isDisabled:  false,           // active org
  createdAt:   "2024-01-15T00:00:00.000Z",
  memberCount: 5,
  taskCount:   12,
};

// ── Subject ───────────────────────────────────────────────────────────────────

import { AdminOrgsTab } from "./orgs-tab.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AdminOrgsTab — suspend dialog Cancel path", () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it("closes the dialog and makes no API call when Cancel is clicked", () => {
    render(<AdminOrgsTab />);

    // Org is initially shown as active; no dialog is open.
    expect(screen.getByText("admin.orgs.statusActive")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument();

    // Click "Suspend" — opens the confirmation dialog.
    fireEvent.click(screen.getByText("admin.orgs.suspend"));
    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument();
    expect(screen.getByText("admin.orgs.suspendOrgTitle")).toBeInTheDocument();

    // Click Cancel — dialog must close without touching the mutation.
    fireEvent.click(screen.getByTestId("dialog-cancel"));

    expect(screen.queryByTestId("alert-dialog")).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    // Org status is still Active — no change in rendered state.
    expect(screen.getByText("admin.orgs.statusActive")).toBeInTheDocument();
    expect(screen.queryByText("admin.orgs.statusSuspended")).not.toBeInTheDocument();
  });

  it("does call the mutation when the Suspend confirm button is clicked (control path)", () => {
    render(<AdminOrgsTab />);

    fireEvent.click(screen.getByText("admin.orgs.suspend"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith({ id: "org-1", isDisabled: true });
  });
});
