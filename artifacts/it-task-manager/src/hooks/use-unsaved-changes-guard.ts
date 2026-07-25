import { useState, useEffect, useRef } from "react";

/**
 * Intercepts browser and in-app navigation while `isDirty` is true and asks
 * the user to confirm before discarding unsaved changes.
 *
 * Coverage:
 *  - Browser close / hard refresh  →  beforeunload
 *  - In-app navigation (sidebar links, setLocation calls)  →  history.pushState wrapper
 *  - Browser back / forward buttons  →  popstate capture phase
 *
 * Usage:
 *   const { dialogOpen, handleLeave, handleStay } = useUnsavedChangesGuard(isDirty);
 *
 * - Render <UnsavedChangesDialog> with those three props.
 * - The Cancel button in the form should call setLocation directly WITHOUT
 *   going through the guard (intentional discard — no prompt needed).
 *   Call `allowNextNavigation()` before setLocation to bypass the guard for
 *   exactly one navigation event.
 * - On successful save, call `allowNextNavigation()` before setLocation so the
 *   post-save redirect is not blocked.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Use a ref so closures inside effects always see the latest isDirty value
  // without needing to re-register listeners on every render.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Pending nav is a thunk that performs the navigation the user tried to do.
  const pendingNavRef = useRef<(() => void) | null>(null);

  // When true the next navigation attempt is allowed through without a dialog.
  // Reset to false immediately after consuming.
  const bypassRef = useRef(false);

  // Remember the current page URL so we can restore it when the back button
  // fires (which changes location.href before we get to react).
  const pageHrefRef = useRef(
    typeof window !== "undefined" ? window.location.href : "",
  );

  // ── beforeunload ────────────────────────────────────────────────────────────
  // Covers hard refresh, closing the tab, and typing a new URL in the address
  // bar. The browser shows its own generic "Leave site?" prompt.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // Legacy Chrome / Firefox require returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── history.pushState wrapper ────────────────────────────────────────────────
  // Covers wouter <Link> components and useLocation / setLocation calls.
  // Wouter has already monkey-patched pushState at module-load time, so
  // `history.pushState` here is wouter's wrapper. Wrapping it again means our
  // guard sits at the outermost layer; calling `original.apply(...)` re-enters
  // wouter's wrapper which does the real push AND dispatches the custom
  // "pushState" event that wouter's subscriber listens to for route updates.
  useEffect(() => {
    const wouterPush = history.pushState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history.pushState = function (this: History, ...args: any[]) {
      if (!isDirtyRef.current || bypassRef.current) {
        bypassRef.current = false;
        return wouterPush.apply(this, args);
      }
      // Capture the intended navigation as a thunk.
      pendingNavRef.current = () => {
        bypassRef.current = true;
        wouterPush.apply(history, args);
      };
      setDialogOpen(true);
    };

    return () => {
      history.pushState = wouterPush;
    };
  }, []);

  // ── popstate (back / forward buttons) ───────────────────────────────────────
  // The capture phase runs before wouter's bubble-phase listener, so we can
  // stop propagation before wouter updates the route.
  // When this fires the browser has already updated location.href to the
  // previous URL. We immediately push our page URL back so the user stays here,
  // then show the dialog. On confirm we push the original target URL.
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (!isDirtyRef.current) return;

      // URL already reflects the destination — capture it before we restore.
      const targetHref = window.location.href;

      // Stop wouter from hearing this popstate so it does not re-render to the
      // previous route.
      e.stopImmediatePropagation();
 
      // Restore our page URL without showing a dialog ourselves — use bypass.
      bypassRef.current = true;
      history.pushState(null, "", pageHrefRef.current);

      // Pending: navigate to where the user wanted to go.
      pendingNavRef.current = () => {
        bypassRef.current = true;
        history.pushState(null, "", targetHref);
        // Dispatch the custom event that wouter's patch would have dispatched
        // so wouter updates its internal location.
        window.dispatchEvent(new Event("pushState"));
      };

      setDialogOpen(true);
    };

    window.addEventListener("popstate", handler, { capture: true });
    return () => window.removeEventListener("popstate", handler, { capture: true });
  }, []);

  // ── dialog handlers ──────────────────────────────────────────────────────────

  const handleLeave = () => {
    setDialogOpen(false);
    if (pendingNavRef.current) {
      pendingNavRef.current();
      pendingNavRef.current = null;
    }
  };

  const handleStay = () => {
    setDialogOpen(false);
    pendingNavRef.current = null;
  };

  /**
   * Call this immediately before an intentional navigation (Cancel button,
   * successful save redirect) so the guard lets exactly one navigation through
   * without showing a dialog.
   */
  const allowNextNavigation = () => {
    bypassRef.current = true;
  };

  return { dialogOpen, handleLeave, handleStay, allowNextNavigation };
}
