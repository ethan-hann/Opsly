/**
 * End-to-end drag-drop drop-zone visibility tests.
 *
 * Confirms that the TopLevelDropZone (`data-testid="top-level-drop-zone"`)
 * remains mounted in the DOM throughout a complete drag gesture, including the
 * Firefox-specific case where `dragend` fires on the source element before
 * `drop` fires on the target.
 *
 * Both tests run on Chromium and Firefox via the project matrix defined in
 * playwright.config.ts so a regression is caught on either engine.
 *
 * Event dispatch strategy:
 *   Playwright's built-in `dragAndDrop` / mouse-drag helpers synthesise native
 *   pointer events which may or may not propagate as HTML drag events depending
 *   on the browser.  Instead we dispatch DragEvents directly via
 *   `page.evaluate()`, giving us full control over the event order.  This lets
 *   us reproduce the Firefox dragEnd-before-drop sequence reliably in both
 *   Chromium and Firefox.
 *
 * Fixture page: /dev-test/tree (dev-only, no auth required).
 * Initial state: Beta (id:2) is a child of Alpha (id:1). Gamma (id:3) is root.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── DragEvent helpers ────────────────────────────────────────────────────────

/** Dispatch a dragstart on the element matching `selector`. */
async function fireDragStart(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`fireDragStart: element not found: ${sel}`);
    const dt = new DataTransfer();
    dt.effectAllowed = "move";
    const evt = new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    el.dispatchEvent(evt);
  }, selector);
}

/** Dispatch a dragend on the element matching `selector`. */
async function fireDragEnd(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`fireDragEnd: element not found: ${sel}`);
    el.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: false }));
  }, selector);
}

/** Dispatch a dragover on the element matching `selector`. */
async function fireDragOver(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`fireDragOver: element not found: ${sel}`);
    const dt = new DataTransfer();
    el.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, selector);
}

/** Dispatch a dragleave on the element matching `selector`. */
async function fireDragLeave(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`fireDragLeave: element not found: ${sel}`);
    el.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: false }));
  }, selector);
}

/** Dispatch a drop on the element matching `selector`. */
async function fireDrop(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`fireDrop: element not found: ${sel}`);
    const dt = new DataTransfer();
    el.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, selector);
}

/**
 * Wait for the deferred dragState update that `onDragStart` schedules via
 * `setTimeout(0)`.  Playwright's `waitForTimeout` gives the JS event loop a
 * chance to flush the microtask and the timer so React can re-render.
 */
async function flushDragStartTimer(page: Page): Promise<void> {
  await page.waitForTimeout(50);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("TaskTreeVisualization — TopLevelDropZone visibility during pointer drag", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev-test/tree");
    // Wait for the fixture page and all three task wrappers to mount.
    await page.waitForSelector('[data-testid="dev-test-tree-page"]');
    await page.waitForSelector('[data-testid="tree-wrapper-1"]');
    await page.waitForSelector('[data-testid="tree-wrapper-2"]');
    await page.waitForSelector('[data-testid="tree-wrapper-3"]');
  });

  // ── Test 1: Drop zone stays in DOM when pointer briefly leaves dragged node ──
  //
  // Sequence: dragstart → (zone mounts) → dragleave on handle →
  //           zone is still in DOM → dragend → zone is still in DOM →
  //           drop on zone → zone disappears.
  //
  // The critical assertion is that the zone stays attached after `dragleave` on
  // the source handle AND after `dragend` fires (deferred clear).

  test(
    "drop zone stays visible when the pointer briefly leaves the dragged node mid-gesture",
    async ({ page }) => {
      const HANDLE   = '[data-testid="drag-handle-2"]';
      const ZONE     = '[data-testid="top-level-drop-zone"]';
      const NODE_ROW = '[data-testid="tree-node-2"]';

      // PRECONDITION: Beta (2) is a child of Alpha (1); no zone visible yet.
      await expect(page.locator(ZONE)).not.toBeAttached();

      // Start drag on Beta's handle (dragState is deferred via setTimeout(0)).
      await fireDragStart(page, HANDLE);
      await flushDragStartTimer(page);

      // Drop zone must appear once dragState is set.
      await expect(page.locator(ZONE)).toBeVisible();

      // Simulate the pointer briefly leaving the source node — this fires
      // dragleave on the handle/row and does NOT end the drag gesture.
      await fireDragLeave(page, NODE_ROW);

      // Zone must still be in the DOM after the dragleave.
      await expect(
        page.locator(ZONE),
        "drop zone must remain attached after pointer leaves the dragged node",
      ).toBeAttached();

      // Simulate Firefox: dragend fires on the source BEFORE drop fires on the
      // target.  Without the deferred clear the zone would unmount here.
      await fireDragEnd(page, HANDLE);

      // Timer has not been flushed yet — zone must still be present.
      await expect(
        page.locator(ZONE),
        "drop zone must stay in DOM immediately after dragend so the pending drop can land",
      ).toBeAttached();

      // Drop lands on the zone (resolves the gesture).
      await fireDragOver(page, ZONE);
      await fireDrop(page, ZONE);

      // After the drop, the zone should eventually be removed.
      await expect(page.locator(ZONE)).not.toBeAttached({ timeout: 3_000 });
    },
  );

  // ── Test 3: Escape cancels the drag and removes the drop zone ─────────────
  //
  // When the user presses Escape (or the drag leaves the window) the browser
  // cancels the drag and fires `dragend` on the source element without firing
  // `drop` on any target.  The deferred setTimeout(0) in onDragEnd queues a
  // dragState clear; once that clear runs the TopLevelDropZone must be removed.
  //
  // Sequence: dragstart → (zone mounts) → Escape key press → dragend fires
  //           (no drop) → deferred clear runs → zone is detached.

  test(
    "pressing Escape during a drag cancels it and removes the drop zone from the DOM",
    async ({ page }) => {
      const HANDLE = '[data-testid="drag-handle-2"]';
      const ZONE   = '[data-testid="top-level-drop-zone"]';

      // PRECONDITION: no zone visible before any drag starts.
      await expect(page.locator(ZONE)).not.toBeAttached();

      // Start the drag gesture on Beta's handle.
      await fireDragStart(page, HANDLE);
      await flushDragStartTimer(page);

      // Zone must appear once dragState is set.
      await expect(page.locator(ZONE)).toBeVisible();

      // Press Escape — in a real browser this fires a drag-cancel which in turn
      // triggers `dragend` on the source element (without a preceding `drop`).
      await page.keyboard.press("Escape");
      // Also dispatch `dragend` explicitly: in this synthetic-event environment
      // the keyboard event alone does not propagate through the browser's native
      // drag-cancel path, so we replicate what the browser would fire.
      await fireDragEnd(page, HANDLE);

      // Allow the deferred setTimeout(0) inside onDragEnd to flush.  No drop
      // event fired, so dragState must be cleared and the zone must be removed.
      await flushDragStartTimer(page);

      await expect(
        page.locator(ZONE),
        "drop zone must be removed after a cancelled drag (Escape)",
      ).not.toBeAttached({ timeout: 3_000 });

      // Confirm the tree itself is still intact — no full-page reload.
      await expect(page.locator('[data-testid="tree-wrapper-1"]')).toBeAttached();
      await expect(page.locator('[data-testid="tree-wrapper-2"]')).toBeAttached();
    },
  );

  // ── Test 2: Drop zone accepts a drop after dragEnd fires first (Firefox order)
  //
  // Explicitly re-creates the Firefox event order:
  //   dragstart → dragover zone → dragend (Firefox fires this early) →
  //   drop zone → Beta promoted to root.
  //
  // The tree update (Beta becomes a root node) proves the drop was accepted.

  test(
    "drop zone accepts a drop and promotes the task to root even when dragend fires before drop (Firefox order)",
    async ({ page }) => {
      const HANDLE = '[data-testid="drag-handle-2"]';
      const ZONE   = '[data-testid="top-level-drop-zone"]';

      // Helper: is tree-wrapper-A a DOM ancestor of tree-wrapper-B?
      async function isWrappedUnder(
        ancestorId: number,
        descendantId: number,
      ): Promise<boolean> {
        return page.evaluate(
          ({ aId, dId }) => {
            const a = document.querySelector(`[data-testid="tree-wrapper-${aId}"]`);
            const d = document.querySelector(`[data-testid="tree-wrapper-${dId}"]`);
            return !!a && !!d && a !== d && a.contains(d);
          },
          { aId: ancestorId, dId: descendantId },
        );
      }

      // PRECONDITION: Beta (2) is nested inside Alpha (1).
      expect(
        await isWrappedUnder(1, 2),
        "Beta should start as a child of Alpha",
      ).toBe(true);

      // Step 1 — start drag.
      await fireDragStart(page, HANDLE);
      await flushDragStartTimer(page);

      // Zone is visible and shows "Drop here to move to top level".
      await expect(page.locator(ZONE)).toBeVisible();
      await expect(page.locator(ZONE)).toContainText(/drop here to move to top level/i);

      // Step 2 — pointer enters the zone (sets dragOver highlight).
      await fireDragOver(page, ZONE);

      // Step 3 — Firefox fires dragend on the source BEFORE drop on the zone.
      await fireDragEnd(page, HANDLE);

      // Zone must still be attached (deferred clear hasn't run).
      await expect(
        page.locator(ZONE),
        "drop zone must remain in DOM after dragend so the drop can still land",
      ).toBeAttached();

      // Step 4 — drop lands on the zone (still present).
      await fireDrop(page, ZONE);

      // After the drop the zone should disappear.
      await expect(page.locator(ZONE)).not.toBeAttached({ timeout: 3_000 });

      // POSTCONDITION: Beta (2) must no longer be nested inside Alpha (1);
      // it has been promoted to a top-level root node.
      expect(
        await isWrappedUnder(1, 2),
        "Beta should be a root node after the drop — no longer inside Alpha's wrapper",
      ).toBe(false);

      // Both tasks must still be present (no full-page refresh).
      await expect(page.locator('[data-testid="tree-wrapper-1"]')).toBeAttached();
      await expect(page.locator('[data-testid="tree-wrapper-2"]')).toBeAttached();
    },
  );
});
