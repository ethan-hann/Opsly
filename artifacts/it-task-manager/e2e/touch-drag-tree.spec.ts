/**
 * End-to-end touch-drag tests for TaskTreeVisualization.
 *
 * Exercises the native-event touch path (touchstart → touchend via
 * addEventListener) that cannot be fully verified by jsdom fireEvent tests
 * because jsdom does not implement document.elementFromPoint or a real layout
 * engine.
 *
 * Test 1 — child → root (promote):
 *   Touch-drag the drag handle of Task Beta (a child of Task Alpha) to the
 *   "Top Level" drop zone.  Confirm Beta appears as a root node after the
 *   gesture WITHOUT a page refresh.
 *
 * Test 2 — root → child (demote):
 *   Touch-drag the drag handle of Task Gamma (a root node) onto Task Alpha's
 *   tree node.  Confirm Gamma appears nested under Alpha after the gesture
 *   WITHOUT a page refresh.
 *
 * Hierarchy assertion strategy:
 *   `data-testid="tree-node-{id}"` is placed on the inner row element.
 *   Children render in a sibling div after the row, so `tree-node-1.contains(tree-node-2)`
 *   is false regardless of nesting.  Instead we use `data-testid="tree-wrapper-{id}"`
 *   which is on the outer container — this div wraps both the row AND the children
 *   subtree, so `tree-wrapper-1.contains(tree-wrapper-2)` is `true` iff task 2
 *   is a DOM descendant of task 1 (i.e. it is rendered as a child of task 1).
 *
 * Assertions follow the precondition → postcondition pattern:
 *   assert initial state, perform gesture, assert changed state.
 *   This rules out false positives from assertions that are trivially always true.
 *
 * The fixture page (/dev-test/tree) is a dev-only route that renders
 * TaskTreeVisualization with controlled state and no auth requirement.
 *
 * Touch simulation:
 *   Playwright's page.touchscreen only supports tap.  We dispatch TouchEvents
 *   via page.evaluate() so we can specify exact clientX/clientY coordinates.
 *   The component's handleTouchEnd listener calls document.elementFromPoint
 *   with the changedTouches[0] coordinates, so the coordinates must point to
 *   the drop target element in the rendered layout.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Touch-event helpers ──────────────────────────────────────────────────────

/**
 * Dispatch a touchstart on the element identified by `selector`.
 * `x`/`y` are clientX/clientY for the single touch point.
 */
async function touchStart(page: Page, selector: string, x: number, y: number) {
  await page.evaluate(
    ({ selector, x, y }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`touchStart: element not found: ${selector}`);
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        }),
      );
    },
    { selector, x, y },
  );
}

/**
 * Dispatch a touchend on the task-tree-container with coordinates that land
 * inside `dropSelector`.  The component's handleTouchEnd listener calls
 * document.elementFromPoint with these coordinates, so they must resolve to
 * the drop target in the real browser layout.
 */
async function touchEndOnTarget(page: Page, dropSelector: string) {
  const dropBox = await page.locator(dropSelector).boundingBox();
  if (!dropBox) throw new Error(`touchEndOnTarget: element not found: ${dropSelector}`);

  const cx = dropBox.x + dropBox.width / 2;
  const cy = dropBox.y + dropBox.height / 2;

  await page.evaluate(
    ({ cx, cy, dropSelector }) => {
      const container = document.querySelector(
        '[data-testid="task-tree-container"]',
      ) as HTMLElement | null;
      if (!container) throw new Error("task-tree-container not found");
      const dropEl = (document.querySelector(dropSelector) ?? container) as HTMLElement;
      const touch = new Touch({
        identifier: 1,
        target: dropEl,
        clientX: cx,
        clientY: cy,
      });
      container.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: [touch],
        }),
      );
    },
    { cx, cy, dropSelector },
  );
}

/**
 * Returns true if the outer wrapper of `ancestorId` contains the outer
 * wrapper of `descendantId` in the DOM.
 *
 * Uses `data-testid="tree-wrapper-{id}"` which is on the outer `<div>` of
 * TaskTreeNode — the div that wraps both the row AND the children subtree.
 * This is the only element that proves nesting: `wrapper-A.contains(wrapper-B)`
 * is true iff task B is rendered as a child of task A.
 */
async function isWrappedUnder(
  page: Page,
  ancestorId: number,
  descendantId: number,
): Promise<boolean> {
  return page.evaluate(
    ({ ancestorId, descendantId }) => {
      const ancestor = document.querySelector(
        `[data-testid="tree-wrapper-${ancestorId}"]`,
      );
      const descendant = document.querySelector(
        `[data-testid="tree-wrapper-${descendantId}"]`,
      );
      if (!ancestor || !descendant) return false;
      return ancestor.contains(descendant) && ancestor !== descendant;
    },
    { ancestorId, descendantId },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("TaskTreeVisualization — touch drag (e2e)", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the dev-only fixture page.  The route is registered outside
    // AuthGuard so no login is required.
    await page.goto("/dev-test/tree");
    // Wait for the fixture page container so we know the tree has mounted.
    await page.waitForSelector('[data-testid="dev-test-tree-page"]');
    // Wait for the three fixture task wrappers.
    await page.waitForSelector('[data-testid="tree-wrapper-1"]');
    await page.waitForSelector('[data-testid="tree-wrapper-2"]');
    await page.waitForSelector('[data-testid="tree-wrapper-3"]');
  });

  // ── Test 1: touch-drag child → Top Level drop zone → promotes to root ─────

  test("touch-dragging a child node to the Top Level zone promotes it to root without a page refresh", async ({
    page,
  }) => {
    // PRECONDITION: Beta (2) starts as a child of Alpha (1).
    // tree-wrapper-1 must contain tree-wrapper-2 before the drag.
    const beforeDrag = await isWrappedUnder(page, 1, 2);
    expect(beforeDrag, "Beta should start nested inside Alpha").toBe(true);

    // Initiate touch on Beta's drag handle.
    const handleBox = await page
      .locator('[data-testid="drag-handle-2"]')
      .boundingBox();
    expect(handleBox).not.toBeNull();
    await touchStart(
      page,
      '[data-testid="drag-handle-2"]',
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );

    // The Top Level drop zone must appear once dragState is set.
    await page.waitForSelector('[data-testid="top-level-drop-zone"]', {
      state: "visible",
    });
    await expect(
      page.locator('[data-testid="top-level-drop-zone"]'),
    ).toContainText(/drop here to move to top level/i);

    // End the touch on the drop zone.
    await touchEndOnTarget(page, '[data-testid="top-level-drop-zone"]');

    // Drop zone disappears after the gesture.
    await expect(
      page.locator('[data-testid="top-level-drop-zone"]'),
    ).not.toBeVisible();

    // POSTCONDITION: Beta must no longer be nested inside Alpha.
    // tree-wrapper-1 must NOT contain tree-wrapper-2 after promotion.
    const afterDrag = await isWrappedUnder(page, 1, 2);
    expect(
      afterDrag,
      "Beta should be a root node — no longer inside Alpha's wrapper",
    ).toBe(false);

    // Both tasks must still be visible (no full-page refresh wiped the tree).
    await expect(page.locator('[data-testid="tree-wrapper-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="tree-wrapper-2"]')).toBeVisible();
  });

  // ── Test 2: touch-drag root → another node → becomes a child ─────────────

  test("touch-dragging a root node onto another task makes it a child without a page refresh", async ({
    page,
  }) => {
    // PRECONDITION: Gamma (3) starts as a root — NOT nested inside Alpha (1).
    const beforeDrag = await isWrappedUnder(page, 1, 3);
    expect(beforeDrag, "Gamma should start as a root, not inside Alpha").toBe(false);

    // Start touch on Gamma's drag handle.
    const handleBox = await page
      .locator('[data-testid="drag-handle-3"]')
      .boundingBox();
    expect(handleBox).not.toBeNull();
    await touchStart(
      page,
      '[data-testid="drag-handle-3"]',
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );

    // Drop zone should appear.
    await page.waitForSelector('[data-testid="top-level-drop-zone"]', {
      state: "visible",
    });

    // End touch on Alpha's tree node row.
    await touchEndOnTarget(page, '[data-testid="tree-node-1"]');

    // Drop zone should disappear.
    await expect(
      page.locator('[data-testid="top-level-drop-zone"]'),
    ).not.toBeVisible();

    // POSTCONDITION: Gamma must now be nested inside Alpha.
    // tree-wrapper-1 must contain tree-wrapper-3 after the drag.
    const afterDrag = await isWrappedUnder(page, 1, 3);
    expect(
      afterDrag,
      "Gamma should now be a child of Alpha — inside Alpha's wrapper",
    ).toBe(true);

    // Both tasks must still be visible (no full-page refresh).
    await expect(page.locator('[data-testid="tree-wrapper-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="tree-wrapper-3"]')).toBeVisible();
  });
});
