# #255 — Confirm outbound webhook taskTemplateId can't reference another org's template on create and update

**State:** PROPOSED
**Depends on:** #184

---

# Cross-org isolation test for outbound webhook taskTemplateId

## What & Why
Task #184 confirmed that outbound webhook projectId references are blocked
cross-org on both POST and PATCH. The same handlers also validate taskTemplateId
with an identical AND orgId = :orgId WHERE clause — but there are no tests
asserting that a caller from org-A cannot set taskTemplateId to a template
owned by org-B.

## Done looks like
- webhooks.test.ts gains two tests:
  · POST /webhooks/outbound: "returns 400 when taskTemplateId belongs to
    another org" — selectQueue pushes [] for the template lookup, assert 400
  · PATCH /webhooks/outbound/:id: same test with hook-lookup first, then []
    for the template lookup, assert 400
- All existing tests still pass

## Relevant files
- artifacts/api-server/src/routes/webhooks.ts — taskTemplateId validation
  on outbound POST (~line 580) and PATCH (~line 720)
- artifacts/api-server/src/routes/webhooks.test.ts — POST and PATCH outbound
  describe blocks
