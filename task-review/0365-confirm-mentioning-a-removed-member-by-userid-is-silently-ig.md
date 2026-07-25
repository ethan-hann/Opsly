# #365 — Confirm @-mentioning a removed member by userId is silently ignored, not delivered

**State:** PROPOSED
**Depends on:** #311

---

# Confirm @-mentioning a removed member by userId is silently ignored, not delivered

## What & Why
An individual @[<userId>:<Name>] mention is validated against the live orgMembersTable query before firing a notification. A user who was an active member when they were @-tagged but has since been removed should not receive the notification. No test currently verifies this behaviour against a live database.

## Done looks like
- A live-DB test seeds an org with an active member and a removed user (no orgMember row)
- A comment is posted with @[removedUserId:Name]
- The test asserts notifyMentions is either not called, or called with recipientUserIds that does NOT contain the removed user's ID

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` — individual mention validation against orgMemberSet (lines ~270-277)
- `artifacts/api-server/src/routes/comments-everyone-mention-db.test.ts` — existing live-DB comments test file to add the new case alongside
