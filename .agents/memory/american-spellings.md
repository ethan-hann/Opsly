---
name: American spellings
description: Always use American English in all user-facing strings, code comments, variable names, and test descriptions.
---

## Rule
Use American English throughout the codebase — in UI strings, code comments, variable/function names, and test descriptions.

**Key pairs to watch:**

| British | American |
|---------|----------|
| organisation | organization |
| colour | color |
| behaviour | behavior |
| cancelled (UI text) | canceled |
| centre | center |
| unrecognised | unrecognized |
| authorise | authorize |
| analyse | analyze |
| grey (UI/CSS) | gray |

**Why:** The product uses American English as its standard. Inconsistent spellings confuse users and make grep/search harder.

**How to apply:**
- Before any PR that touches UI strings or comments, grep for the British forms listed above.
- Do NOT rename database columns, JSON API field names, or URL paths that already use American spelling (they are already correct).
- Do NOT change third-party library names or ECMAScript spec terms (e.g. `onFulfilled`).
- The rule applies to new code going forward and should be applied opportunistically when touching existing files.
