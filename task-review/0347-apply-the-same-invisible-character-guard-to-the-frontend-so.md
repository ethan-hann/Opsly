# #347 — Apply the same invisible-character guard to the frontend so the palette editor can't submit blank emoji

**State:** PROPOSED
**Depends on:** #306

---

# Apply the same invisible-character guard to the frontend palette editor

## What & Why
The API now rejects invisible/whitespace-only emoji with a 422, but the org-settings palette editor has no client-side guard. An admin can still type or paste an invisible character, see it appear as a blank pill in the preview, and only discover the problem after hitting Save (and receiving an error toast). A matching frontend check gives immediate, inline feedback before the request is even sent.

## Done looks like
- The palette input in `artifacts/it-task-manager/src/pages/org-settings.tsx` (ReactionPaletteCard) validates each entry against the same invisible-character set before enabling the Save button
- Invisible/whitespace-only entries are highlighted or rejected with an inline error message
- The Save button stays disabled while any invalid entry exists

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` — ReactionPaletteCard component
- `artifacts/api-server/src/routes/orgs.ts` — INVISIBLE_ONLY_RE regex (mirror this client-side)
