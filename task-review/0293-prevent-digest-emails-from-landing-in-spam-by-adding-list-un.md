# #293 — Prevent digest emails from landing in spam by adding List-Unsubscribe headers

**State:** PROPOSED
**Depends on:** #174

---

# Prevent digest emails from landing in spam by adding List-Unsubscribe headers

## What & Why
Major email clients (Gmail, Outlook, Apple Mail) and spam filters look for RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers to show a native unsubscribe button and to avoid flagging bulk email as spam. The one-click token is now in place, but the headers aren't set on outbound digests, so the emails are missing a key deliverability signal.

## Done looks like
- `sendMail` (or the digest-mailer call site) sets `List-Unsubscribe: <{unsubscribeUrl}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers on digest emails
- The unsubscribe URL used in the headers matches the one embedded in the email body
- A unit test confirms the headers are present when `unsubscribeUrl` is provided

## Relevant files
- `artifacts/api-server/src/lib/email.ts` (sendMail, MailOptions)
- `artifacts/api-server/src/lib/digest-mailer.ts`
