# Manual check: the unified substrate, slice 07 (compose, replies and the exact send)

Commit: dd38e6e (HEAD before the slice 07 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-07/` (eight screens, light and dark, 390 wide, from the bench through the real stylesheets)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | With `VITE_JARVIS_FLAGS` empty: open Email | The Email tab is exactly what it was (MessagesFlow). No Compose button, no Reply of this slice. | Everything here lives inside `EmailFlow`, mounted only behind `flagOn("email_intake_v1")`; the suite and build are green with the flag off | device |
| 2 | With `email_intake_v1` on, 0044 to 0050 applied, `api/email/send` and `api/email/reconcile` deployed, a Gmail connected: tap Compose, write to your own other address, Review Send | The review shows From (the account), To, the subject, the whole body, "Not Sent Yet", and "Your Approval Covers Only This Account, These Recipients and This Exact Message" | Proven in jsdom and SQL (the snapshot is the row's); the live round trip is the device check | device |
| 3 | Tap Send This Message once | "Sent" with "Gmail Accepted It · Accepted Is Not Read"; the message is in Gmail's Sent and arrives at the other address; Brain > AI Hub > Activity shows "Sent to <address>" with Gmail's id; Drafts and Sent From JARVIS lists it as Sent | Proven in jsdom (the one post), the route test (the one Gmail call, the ack on the receipt) and SQL (the state machine); a real send is the device check, to yourself | device |
| 4 | Tap Send This Message twice fast, or from two phones | One message in Gmail's Sent, one receipt; the second tap says the same action | Proven in jsdom (one post) and SQL (the draft row is the lock; the same nonce replays, another is refused); two real phones are the device check | device |
| 5 | Review Send, then Edit Message, change a recipient, Review Send again, Send | The first review is cancelled in Activity; the second send carries the new recipient; nothing left under the old approval | Proven in jsdom and SQL (REVIEW_CHANGED on a moved revision) | device |
| 6 | Review Send and wait six minutes before tapping | "Approval Expired · Review It Again" and the tap is Review Again; nothing sent | Proven in jsdom and SQL | device |
| 7 | Reply All on a message with several recipients | To is the sender (or its Reply-To), Cc everyone else minus your own addresses, subject with Re:, and the reply lands in the same Gmail thread | Proven by the rules (`drafts.test.ts`), jsdom, and the raw message (In-Reply-To, References, threadId); the thread in Gmail is the device check | device |
| 8 | Attach a PDF, Review Send, Send | The attachment is listed with its size on the review; it arrives intact; changing the stored file between review and send is refused as "Not Sent · An Attachment Changed Since the Review" | Proven in the route test (hash checked from the stored bytes); the upload from a phone is the device check | device |
| 9 | Airplane mode in the composer, then Review Send | "Connect to Send · Your Draft Is Saved on This Device"; nothing queued; back online, the draft is in Drafts with the words | Proven in jsdom | device |
| 10 | Type a draft, kill the app, reopen, Email > freshness line > Drafts and Sent From JARVIS | The draft is there (On This Device when it never reached the server) with every word | Proven in jsdom with a seeded local copy; the kill is the device check | device |
| 11 | Edit the same draft on two phones | The second save shows both copies with Keep This Draft and Use Newer Draft; nothing overwritten in silence | Proven in jsdom and SQL (DRAFT_CONFLICT carries the server's copy) | device |
| 12 | Cut the network the instant after Send | "Send Status Unknown · Check Gmail Before Trying Again", resend shut; Check Again finds it in Gmail or says Still Unknown; Activity shows the unknown receipt and, once found, the confirmed one | Proven in the route test (a timeout is one call, settled unknown; reconcile settles only on a found message) and SQL; the cut is the device check | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The bench's session is a fixture; the Gmail token is minted on the server and never answered; the service role never leaves the server.
- [x] Anything visual was mocked first: eight screens through the real components and stylesheets before anything was committed (the previews folder).
- [x] The laws pass: inside the tests stage, with `sends.ts` and `worker.ts` taken off the unwired list (they are wired now).
- [x] No em dashes.
- [x] No demo data reaches a build: the bench is deleted before the commit.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: the previews are 390 wide.

## What I would tell Dave in one line

You can now write, reply and send from Email: every send is one review of exactly what will leave and one tap that sends it once, with a receipt; a draft is saved as you type, on your phone and in JARVIS, and nothing is ever sent for you, queued for later or resent on its own.

## Notes

The device rows stay open on purpose: no device, no deployment and no live
Gmail in this session. Row 1 is the one that matters for the deploy with the
flag off; row 3 is the first real send, to yourself.

**Result: open**
