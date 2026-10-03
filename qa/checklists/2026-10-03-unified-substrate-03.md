# Manual check: the unified substrate, slice 03 (shared commands, exact approvals and receipts)

Commit: 919e6db (HEAD before the slice 03 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: not applicable, no screen (the cards are slice 06, Activity is slice 04)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Use the app as before: Today, Life, Schedule, Email, Money, Settings | Nothing changed. No new tab, no new card, no new copy. | No component touched in this slice; full suite green, build green | device |
| 2 | On the live project, after 0044 to 0046 are applied: `select activity_feed(5);` in the SQL editor as a signed-in user | `{"rows":[...],"email_review_count":0,"scope":"global"}` and nothing in the app behaves differently | Proven locally only; the live project is untouched | device |
| 3 | On the live project: `select capture_approve(gen_random_uuid(), 1, 'x', 'k', '{}');` as a signed-in user | `{"error":"NOT_FOUND"}` and no row anywhere | Proven locally only | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The outbox worker never sees a Gmail token; the functions store hashes and ids.
- [x] Anything visual was mocked first: nothing visual in this slice.
- [x] The laws pass: inside the tests stage, with two roster entries added and their reasons written (the send client and the worker wait for slice 07).
- [x] No em dashes.
- [x] No demo data reaches a build.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Nothing at phone width to check.

## What I would tell Dave in one line

A card becomes a bill, a task, an appointment or a thing you're waiting on in one tap and one transaction, bound to exactly what you saw, with a receipt that says exactly what happened, an Undo that only removes what it made, and a send path that can say "I don't know" instead of sending twice.

## Notes

The phone rows stay open on purpose: no device and no deployment in this
session. Rows 2 and 3 are the two live checks that would prove the migration
applied without changing the app.

**Result: open**
