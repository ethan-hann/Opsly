# Task Trees — Feature Testing Guide

A walkthrough for verifying every part of the Task Trees feature end-to-end.

---

## 1. Setup — Enable the feature

1. Sign in as an **Owner** or **Admin**.
2. Go to **Org Settings → Instance Admin → Features**.
3. Make sure **Task Trees** is set to **Enabled**.
4. In **Org Settings → Roles**, confirm the **Admin** role has **Link Tasks (Task Trees)** toggled on.

---

## 2. Create a project and tasks

1. Create a new project: **"Website Launch"**.
2. Inside the project, create these tasks — **leave the "Depends on" field empty for now** (Step 3 will link them):

   | # | Title               |
   |---|---------------------|
   | A | Design mockups      |
   | B | Write copy          |
   | C | Build landing page  |
   | D | QA review           |
   | E | Deploy to prod      |

---

## 3. Link tasks via the Project Task Tree tab

1. Open **Website Launch → Task Tree tab**.
   - You should see all 5 tasks listed as root nodes (no hierarchy yet).
2. Click **Link tasks**.
3. Set **Task (blocked)** = *C: Build landing page*, **Task (blocker)** = *A: Design mockups*. Click **Add link**.
4. Repeat for:
   - C depends on B
   - D depends on C
   - E depends on D
5. **Expected result:** The tree shows A as the primary parent of C (A has a lower task number, so it "wins" when C has multiple parents). The hierarchy:

   ```
   📁 A: Design mockups
     📁 C: Build landing page
       📁 D: QA review
         📄 E: Deploy to prod
   📄 B: Write copy
   ```

   *(B shows as a leaf in the project tree because its only child, C, is already rendered under A. The dependency still exists — visible on C's detail page — but the project tree renders each task once to avoid duplication.)*

6. Use **Expand all** / **Collapse all** buttons (top-right of the tree) to verify all nodes fold and unfold correctly.

---

## 4. Focused tree on task detail

1. Open task **D: QA review**.
2. Scroll to the **Task Tree** card.
   - **C** appears above D (shown as an ancestor) and **E** appears below D (child).
   - **D** itself has a distinct ring/bold highlight.
3. Click **View full tree →**.
   - **Tabbed layout:** the Task Tree tab is selected automatically with D highlighted.
   - **Stacked layout:** the page scrolls to the tree section with D highlighted.

---

## 5. Dependency picker shows all project tasks

1. Create a new task **G: Late addition** in the project with no dependencies.
2. Open task **G** and scroll to the **Task Tree** card.
3. Click **Add dependency**.
4. Search for "Design" — **A: Design mockups** should appear in the list.  
   *(Confirms the picker draws from all project tasks, not just adjacent nodes.)*
5. Select A — G now depends on A. Confirm A appears above G in the focused tree.

---

## 6. Blocked banner

1. Open task **E: Deploy to prod**.
2. Confirm **D: QA review** is shown as a dependency and is still **Open**.
3. **Expected:** A red "Blocked — 1 open task must be completed first: TSK-N" banner appears where TSK-N is a clickable link to D.

---

## 7. Blocked status change (422 enforcement)

The dependency chain is **A → C → D → E** and **B → C → D → E**. A task can only be
closed after ALL its parent dependencies are already closed. You must close from the
leaves upward: A and B first, then C, then D, then E.

1. Open task **E: Deploy to prod** and try to move it to a closed stage (e.g. "Done").
   **Expected:** Rejected (HTTP 422) — toast names D as the blocker. Status unchanged.
2. Open task **D: QA review** and try to move it to "Done".
   **Expected:** Rejected — toast names C as the blocker.
3. Open task **C: Build landing page** and try to move it to "Done".
   **Expected:** Rejected — toast names A and B as blockers.
4. Open task **A: Design mockups** and move it to "Done". **Expected:** Succeeds (no parents).
5. Open task **B: Write copy** and move it to "Done". **Expected:** Succeeds (no parents).
6. Return to **C: Build landing page** and move it to "Done".
   **Expected:** Succeeds — A and B are now closed.
7. Return to **D: QA review** and move it to "Done". **Expected:** Succeeds.
8. Return to **E: Deploy to prod** and move it to "Done". **Expected:** Succeeds.

---

## 8. Auto-close children

Before starting: **re-open tasks C, D, and E** from Step 7 (move them back to an open
stage). A and B can remain closed.

1. Open task **C: Build landing page**.
2. In the Task Tree card, enable **Auto-close children when this task is closed**.
3. Move C to a closed stage ("Done").
4. **Expected:** C closes, and **D: QA review** automatically moves to the same closed
   stage in the same action.
5. Open task D and check its **History** tab — it should have an audit event recording
   the auto-close triggered by C.

---

## 9. Cycle detection

1. Open the **Project Task Tree** tab.
2. Try to link **A: Design mockups** as depending on **E: Deploy to prod**  
   *(A → C → D → E → A would be a cycle)*.
3. **Expected:** The API rejects with a toast showing the specific cycle path using task numbers, e.g. *"Dependency would create a cycle: TSK-14 → TSK-18 → TSK-17 → TSK-16 → TSK-14"*.  
   *(The path traces the existing chain in reverse — from the proposed new parent back to the proposed new child — showing exactly how the cycle would close.)*

---

## 10. Cross-project rejection

1. Create a second project **"Other Project"** with one task: **F: Other task**.
2. In the Website Launch project tree, try to link **A** as depending on **F**.
3. **Expected:** Rejected with HTTP 400 "Cross-project dependency linking is not supported".

---

## 11. Permission gate — Member role

1. Invite a user with the **Member** role (ensure Member does NOT have `link_tasks`).
2. Log in as that member.
3. Open the project Task Tree tab — the **Link tasks** button should be hidden.
4. Open a task detail — the **Add dependency** button should be hidden.
5. Confirm the × remove buttons are also hidden on all nodes.

---

## 12. Feature gate — Task Trees disabled

1. As Admin, go to **Org Settings → Instance Admin → Features** and set **Task Trees** to **Disabled**.
2. Reload the app.
3. **Expected:**
   - The **Task Tree** tab on the project detail page is gone.
   - The **Task Tree** card on task detail pages is gone.
   - The **Link Tasks** toggle in role settings is hidden.
   - Closing a task with open parents succeeds (feature gate lifts the 422 block).
4. Re-enable Task Trees before continuing.

---

## 13. Status change preserves the tree

1. Open any task that has dependencies configured (e.g., **C**).
2. In the Task Tree card, note the current tree structure.
3. Change the task's **status** using the status selector in the sidebar.
4. **Expected:** The Task Tree card remains visible and unchanged — the tree does not collapse or go blank after the status update.

---

## Checklist summary

| # | Test | Pass? |
|---|------|-------|
| 3 | Project tree shows A→C→D→E with A as primary parent | ☐ |
| 3 | Expand all / Collapse all buttons work | ☐ |
| 4 | Task detail shows focused tree; D highlighted, C above, E below | ☐ |
| 4 | "View full tree →" selects Task Tree tab (tabbed) / scrolls (stacked) | ☐ |
| 5 | Dependency picker lists all project tasks | ☐ |
| 6 | Blocked banner shows open parent task number as a clickable link | ☐ |
| 7 | Closed-stage blocked by open parent → specific 422 toast | ☐ |
| 8 | Auto-close children cascades on parent close | ☐ |
| 9 | Cycle detection toast shows TSK-X format task numbers | ☐ |
| 10 | Cross-project link → 400 | ☐ |
| 11 | Member without `link_tasks` sees no controls | ☐ |
| 12 | Task Trees disabled hides all surfaces and lifts 422 block | ☐ |
| 13 | Status change does not reset tree visualization | ☐ |
