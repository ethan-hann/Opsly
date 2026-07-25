# #276 — Confirm re-applying a template doesn't wipe custom field mappings the admin added manually

**State:** PROPOSED
**Depends on:** #146

---

# Confirm re-applying a template doesn't wipe custom field mappings the admin added manually

## What & Why
The Re-apply template button merges template defaults (defaultTitle, defaultPriority, defaultCategory) into the existing TemplateBuilder state using a spread that preserves fields the template doesn't cover. A regression here — e.g. from a future change to applyTaskTemplate — would silently delete manually-configured field mappings that aren't part of the template, causing webhooks to stop populating custom fields.

## Done looks like
- A test (or series of assertions) verifies that calling applyTaskTemplate when the template only sets defaultPriority leaves titleField, fieldMapping, and all other template state intact
- Covers the case where the admin has added a custom field mapping row before clicking Re-apply

## Relevant files
- `artifacts/it-task-manager/src/pages/webhook-inbound-edit.tsx` — applyTaskTemplate function and TemplateBuilder component
