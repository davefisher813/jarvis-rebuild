# Manual check: the unified substrate, slice 08 (Waiting and the restrained Today feed)

Commit: ae3c96a (HEAD before the slice 08 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-08/` (Waiting and the Today band, light and dark, 390 wide, from the bench through the real stylesheets)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | With `VITE_JARVIS_FLAGS` empty: open Today and Email | Today's mail band and the Email tab are exactly what they were; no Waiting list, no Email band of this slice | Both live behind `flagOn("email_intake_v1")`; the suite and build are green with the flag off | device |
| 2 | With `email_intake_v1` on and 0044 to 0051 applied: Track This on a mail, then Email > Waiting | The record under Open: the title, "Waiting On <person>", "Today"; no red anywhere | Proven in jsdom against the in-memory Store | device |
| 3 | Open the record, tap Resolve | "Resolved · <title>" on the toast and in Brain > AI Hub > Activity; the record under Resolved; Gmail shows no new mail from you | Proven in jsdom and SQL (one record, one receipt, no send) | device |
| 4 | Reopen it, set a Follow-Up Date of today, open Tasks and Schedule | The row shows "Follow Up Today" in warning; Tasks and Schedule gained nothing | Proven in jsdom and SQL (no task, no event) | device |
| 5 | Have the other person reply in the same thread, refresh Email | "New Reply" on the row and the record; Review Reply opens their message; the record is still Open | Proven in jsdom and SQL (`threads_latest`); a real reply is the device check | device |
| 6 | Tap Draft Follow-Up | The composer with their real address in To, "Re: <subject>", threaded; nothing sent until you review and tap | Proven in jsdom (the address from the thread, the headers) | device |
| 7 | Delete the source email in Gmail, refresh, open the record | "Source Email Deleted · Excerpt Kept" with the excerpt still shown; Open Source Message gone | Proven in jsdom and SQL | device |
| 8 | Today, with two cards waiting in Email and a tracked record whose follow-up is today | The band "Email": "2 Email Items to Review" then "<record> · Waiting On <person> · Follow Up Today"; no card title or amount on Today | Proven in jsdom (`EmailToday.test.tsx`) and SQL (the count carries no payload) | device |
| 9 | Tap the review line | The Email tab narrowed to the rows with cards, "Showing Items to Review · N", Show All restores | Proven in jsdom | device |
| 10 | Add a mail-origin task due tomorrow and an event tomorrow; open Today | Neither on Today; the task is in Tomorrow or Tasks, the event in Schedule | Proven in jsdom (`emailTodayRows` keeps tomorrow off) | device |
| 11 | With nine eligible items | Five rows at most, the count first; the dealt task Your Move already shows is not repeated | Proven in jsdom | device |
| 12 | At 200% text, the Waiting record and the Today band | No clipped title; the rows stack; the date field stays reachable | Not checked on a device | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The bench's session is a fixture.
- [x] Anything visual was mocked first: the Waiting list, the record and the Today band were rendered through the real components and stylesheets before anything was committed (the previews folder).
- [x] The laws pass: inside the tests stage. The frozen Today TV guide in `YourDay.tsx` was not touched; `tvGuide.test.ts` holds its hash.
- [x] No em dashes.
- [x] No demo data reaches a build: the bench is deleted before the commit.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: the previews are 390 wide.

## What I would tell Dave in one line

Email now keeps what you are waiting on: who, since when, a follow-up date that is only a reminder, a New Reply flag that never closes anything for you, Resolve and Reopen with receipts, and a follow-up draft to the real address; Today says only how many email items wait for you and which committed things are due, five lines at most.

## Notes

The device rows stay open on purpose: no device, no deployment and no live
Gmail in this session. Row 1 is the one that matters for the deploy with the
flag off.

**Result: open**
