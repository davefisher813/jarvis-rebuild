# Manual check: the unified substrate, slice 09 (hardening, full integration and production verification)

Commit: 1c0162f (HEAD before the slice 09 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: `qa/previews/unified-substrate-09/` (the Email review focus with one card loaded and three more past the loaded pages, light and dark, 390 wide, from the bench through the real stylesheets); no other screen changed its drawing

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained." And: "do NOT merge to main - report back as each prompt's work lands and wait for Dave's go-ahead before any merge."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Deploy with `VITE_JARVIS_FLAGS` empty | Today, Email, Brain and every other tab exactly as before; the old mail pumps still run | Flag off is the build's default; the suite, the laws and the build are green with it off | device |
| 2 | Apply 0044 to 0051 on the project (in order), then run the forward scripts a second time | Both passes clean; no error about an existing object | Rehearsed on a local Postgres 16: fresh install, rollback 0051 to 0044 in reverse, forward again, forward twice (`tests/rehearsal.sh`) | project |
| 3 | Set `email_intake_v1` (and `substrate_v1`), set `JARVIS_CONTEXT_KEY`, deploy `api/email/*`, open the app | The Email tab is the unified one; Today's mail band is the Email band; More > Advanced lists the flags on | Not run: no deploy authorisation in this session | device |
| 4 | With the flag on, leave the app open on Today for 10 minutes with Gmail connected | No snapshot refresh, no auto-reply, no old outbox send: nothing happens without a tap (the old pumps no longer mount) | Proven in the source (`AppShell.tsx`) and by the law that the module runs nothing on a timer | device |
| 5 | Turn AI off in Brain > AI Hub, then use Email end to end: open, capture, save a card, track, resolve, compose, review, send to yourself | Everything works; no model is called; the agent endpoints answer 403 | The module imports no AI client (law 5); the gateway proof covers the 403 | device |
| 6 | Go offline, open Email | Cached mail and drafts readable; Save, Send and Resolve say Connect first; nothing queues | Proven in jsdom (slices 05 to 08) | device |
| 7 | Revoke the Gmail grant in Google, pull to refresh | The mailbox says Reconnect with the one fix; cached mail stays; nothing is sent | Proven in jsdom and SQL (slices 03, 05) | device |
| 8 | Sign out, sign in as someone else on the same phone | No mail, no drafts, no readings, no area taps or rules from the first person | The purge now takes the area taps and rules too (`clearLocalData.ts`) | device |
| 9 | Today's "N Email Items to Review", tap it | Email opens narrowed; the line's number is N, or the loaded part of N with "M More in Older Mail" | Proven in jsdom; the two counts are one set | device |
| 10 | 200% text (Settings > Accessibility > Larger Text) on the record screen, the composer and the Today band | No clipped title; rows stack; every control reachable | Not checked: no device | device |
| 11 | VoiceOver through the Email list, a card, the composer and the review | Every row and control announces its words; the door rows answer the rotor's activate | Not checked: no device | device |
| 12 | Scroll 500 cached rows on the phone | Smooth; no stutter on a card save or a sync | Counted in jsdom (`InboxList.test.tsx`: no row redraws unless it changed); timing needs the phone | device |
| 13 | The first real send: a message to your own address, through Review Send | Sent with the receipt's words; Gmail shows one message; no second copy on a second tap | Not run: no real send in this session, by the rules | device |
| 14 | Merge to main through the protected workflow, on Dave's word; verify the live commit at the deploy URL | The deployed commit is the merged one; the Email route answers | Not run: merge needs Dave's go-ahead; deploy authorisation is not in this session | Dave |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The rehearsal's leakage inspection ran against the local Postgres only.
- [x] Anything visual was mocked first: the review focus line was rendered through the real component and stylesheets before the commit (the previews folder); the Remember toast is the app's toast with new words.
- [x] The laws pass: inside the tests stage, the new law 5 among them. The frozen Today TV guide in `YourDay.tsx` was not touched; `tvGuide.test.ts` holds its hash.
- [x] No em dashes.
- [x] No demo data reaches a build: audited (`laws/noDemoData.test.ts`, and the slice 09 audit in the evidence).
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Phone width: no new screen.

## What I would tell Dave in one line

The nine slices are on one branch, proven in the repo and on a local database as far as a session without your phone, your Gmail and the deploy can go; what is left is yours: apply the migrations, set the flags, deploy the routes, send one message to yourself, and say the word on the merge.

## Notes

Rows 1 to 13 are device, project or Dave; none can be closed from this
session. Row 14 is the merge, which this session was told not to do.

**Result: open**
