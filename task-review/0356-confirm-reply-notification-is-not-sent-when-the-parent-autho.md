# #356 — Confirm reply notification is not sent when the parent author is the same person replying

**State:** PROPOSED
**Depends on:** #307

---

# Confirm reply notification is not sent when the parent author is the same person replying

## What & Why
The notification block guards against self-notification with `parentCommentUserId !== actorId`, but there is no test verifying this path. A regression could cause users to receive spurious notifications for their own replies.

## Done looks like
- A test posts a reply where the authenticated user is also the parent comment's author
- The test confirms `notifyCommentReply` is NOT called in that case

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` — lines 313-322 (reply notification guard)
- `artifacts/api-server/src/routes/comments.test.ts`
