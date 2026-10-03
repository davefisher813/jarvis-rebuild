# Manual check: the unified substrate, slice 06 (deterministic candidates and destination captures)

Commit: c812446 (HEAD before the slice 06 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-06/` (nine card screens, light and dark, 390 wide, from the bench through the real stylesheets)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | With `VITE_JARVIS_FLAGS` empty: open Email | The Email tab is exactly what it was (MessagesFlow). No card anywhere. | The cards live inside `EmailFlow`, which mounts only behind `flagOn("email_intake_v1")`; the suite and build are green with the flag off | device |
| 2 | With `email_intake_v1` on, 0044 to 0049 applied and a Gmail connected: open Email with a real bill in the inbox (a sender with "Amount due" and a due date) | A green Money card under the row: the amount large, "Due <date> · <issuer>", Save Bill and Details; nothing under a newsletter or a plain note | Proven in jsdom and the bench against the fixture mail; a real mailbox's wording is the device check | device |
| 3 | Tap Save Bill | One toast "Saved $<amount> Bill to Money" with Undo; the card becomes "✓ Saved Bill · $<amount>" with View; Money > Bills shows it once with the email as its source; no second question | Proven in jsdom (the one call, the receipt line, the Undo) and against the in-memory ledger (the row in LedgerService's list); the live round trip is the device check | device |
| 4 | Tap Save Bill a second time on the same mail, after Undo | The same card again, one bill in Money; never two | Proven in SQL (`capture_approve` replay by idempotency key and the Money fingerprint) and in jsdom | device |
| 5 | Open a mail with a time in it ("call on October 4 at 10 AM Eastern") | A blue Schedule card with the day, the wall clock and the zone; Add to Schedule puts one event on that day at that hour in your zone | Proven by the rules (`extract.test.ts`), the adapter (`toModules.test.ts`) and jsdom; Schedule's own drawing of it is the device check | device |
| 6 | Tap the cross on a card | The card goes, the mail stays; More > Show Dismissed Suggestions shows it with Restore; Refresh does not bring it back on its own | Proven in jsdom and SQL (the same fingerprint stays dismissed) | device |
| 7 | More > Capture > Capture a Task on a mail with no card | The sheet opens empty with the mail's text under Source Evidence and "Adds Only the Task · Sends Nothing"; typing a title opens Add Task; the task is in Tasks with the mail as its source; AI level Off changes nothing here | Proven in jsdom with no model call recorded | device |
| 8 | Edit a mail's copy in Gmail (or wait for a provider edit), then look at its card | "Email Changed · Review These Details" with Review Latest Details, no Save; the review redraws the card from the latest copy | Proven in jsdom against a changed source hash; a provider-side change is the device check | device |
| 9 | Airplane mode, then a card's Save | "You're Offline · Try Again When Connected" on the card; nothing queued, nothing saved | Proven in jsdom (offline refusal before any call) | device |
| 10 | At 200% text, a card and the sheet | The amount wraps before it clips; Save and Details stack; the sheet's fields stay reachable above the keyboard | Not checked on a device | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The bench's session is a fixture; the rules run on the device and call no model.
- [x] Anything visual was mocked first: nine screens through the real components and stylesheets before anything was committed (the previews folder).
- [x] The laws pass: inside the tests stage, with `src/email/` named as the Email module in the substrate boundary law (it is the Email module since slice 05).
- [x] No em dashes (the time-range rule matches dash characters by a range, not by the character).
- [x] No demo data reaches a build: the bench is deleted before the commit.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: the previews are 390 wide.

## What I would tell Dave in one line

Under a bill, a receipt, a request, a time or a promise in your mail there is now one card that names exactly what one tap will do, does only that, once, with a receipt and an Undo; nothing is saved until you tap, nothing is read by a model, and Capture in More does the same by hand for any mail.

## Notes

The device rows stay open on purpose: no device, no deployment and no live
Gmail in this session. Row 1 is the one that matters for the deploy with the
flag off.

**Result: open**
