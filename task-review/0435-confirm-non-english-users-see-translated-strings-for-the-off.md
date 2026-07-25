# #435 — Confirm non-English users see translated strings for the offline banner and scroll buttons

**State:** PROPOSED
**Depends on:** #419

---

# Confirm non-English users see translated strings for the offline banner and scroll buttons

## What & Why
Task #419 added translations for newly extracted keys across 7 locales (de, es, fr, ja, pt, zh, ar). There are no automated tests verifying that i18n keys resolve to non-English strings at runtime — a missing key silently falls back to English, hiding regressions.

## Done looks like
- A test (or i18n lint step) checks that the target keys exist in each locale file with non-English values
- The test runs in CI (api-server-tests or a dedicated i18n check workflow)
- Key groups covered: common (youreOffline, scrollToTop/Bottom, changesQueued), tasks, notes, projects SLA override, orgSettings branding/members/roles/templates/export, customFields, search, markdown

## Relevant files
- `artifacts/it-task-manager/src/i18n/locales/` (all locale JSON files)
- `artifacts/it-task-manager/src/i18n/` (i18n setup)
