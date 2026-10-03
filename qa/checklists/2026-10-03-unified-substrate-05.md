# Manual check: the unified substrate, slice 05 (the Email tab: inbox, search, accounts, provider evidence)

Commit: 48b0b66 (HEAD before the slice 05 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-05/` (seven Email screens, light and dark, 390 wide, from the bench through the real stylesheets)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | With `VITE_JARVIS_FLAGS` empty: open Email | The Email tab is exactly what it was (MessagesFlow). Nothing changed anywhere. | The new flow mounts only behind `flagOn("email_intake_v1")`; the suite and build are green with the flag off | device |
| 2 | With `VITE_JARVIS_FLAGS=email_intake_v1`, 0044 to 0048 applied, the five `api/email/*` routes deployed, and a Gmail connected under Settings > Connections: open Email | The inbox of every connected mailbox, newest first, day headers, "Updated Today · <time> · N Accounts" under the title; thirty rows then "Showing what's loaded so far." with Load More | Proven in jsdom and in the bench against a fixture session; the live sync is the device check | device |
| 3 | Pull down, or tap Refresh | The freshness line moves only after a good sync; the scroll position stays; rows already loaded keep their order | Proven in jsdom (the merge) and SQL (the cursor and freshness); the gesture is the device check | device |
| 4 | Open an unread message | The badge clears in the list; the body shows with remote images off and Show Images; Mark as Unread in More puts the badge back; airplane mode mid-open shows "Couldn't Mark as Read" with Retry | Proven in jsdom; the provider round trip is the device check | device |
| 5 | More > Archive, then Undo on the toast | The row leaves the inbox and Gmail shows it archived; Undo puts it back in both; Brain > AI Hub > Activity shows "Archived · <subject>" with Gmail's answer | Proven in jsdom (the calls) and SQL (the receipt); the live round trip is the device check | device |
| 6 | Search a word that is in a message older than the loaded page | Saved mail answers first, labelled "Saved Mail · N Messages Searched"; then "Gmail · All Accounts · N Messages"; opening a result and coming back keeps the query | Proven in jsdom; Gmail's own search is the device check | device |
| 7 | Revoke the app's access in the Google account, then open Email | The mail stays; "Gmail Needs Reconnecting · Saved Mail Is Still Here" with Reconnect Gmail, which opens Connections | Proven in jsdom and SQL (the reauth state); the revocation is the device check | device |
| 8 | Airplane mode, then open Email | "Offline · Showing Saved Mail"; the last page and every opened message read; nothing is queued | Proven in jsdom | device |
| 9 | Tap the freshness line | Accounts: each mailbox with its state and last good sync; "Disconnecting Keeps Saved Mail and Every Approved Record · Only the Sign-In Goes" | Proven in jsdom and the bench | device |
| 10 | At 200% text, every screen | No clipped sender, date or subject; the subject wraps; controls stack | Not checked on a device | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The bench's session is a fixture; no token exists; the Gmail token never leaves the server (`api/_email.ts`).
- [x] Anything visual was mocked first: the seven screens were rendered through the real components and stylesheets before anything was committed (the previews folder).
- [x] The laws pass: inside the tests stage, with `categoryTaps.ts` taken off the unwired list (it is wired now).
- [x] No em dashes.
- [x] No demo data reaches a build: the bench is deleted before the commit; its only input is a dev HTML page the production build never includes.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: the previews are 390 wide.

## What I would tell Dave in one line

Behind a flag, the Email tab reads every Gmail you connected through JARVIS's own server, newest first, with honest freshness, honest search coverage, remote images off until you ask, and archive and trash that leave a receipt and can be undone; nothing in it extracts, infers or sends.

## Notes

The device rows stay open on purpose: no device, no deployment and no live
Gmail in this session. Row 1 is the one that matters for the deploy with the
flag off.

**Result: open**
