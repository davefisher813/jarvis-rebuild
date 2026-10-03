# Manual check: the unified substrate, slice 01 (repository contract and shared schema)

Commit: 68ef481 (the slice 01 commit on `claude/trusting-faraday-avniag`; this checklist, the previews and the gate result land in the commit on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo; the phone rows are Dave's
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: qa/previews/2026-10-03-unified-substrate-01/ (the Advanced card, 390 by 844, both themes, before and after the migration)

**What Dave asked for, in his words:** "Start with JARVIS-Unified/START-HERE.md, then work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09). Work on your own branch, keep it rebased on main, and do NOT merge to main - report back as each prompt's work lands and wait for Dave's go-ahead before any merge."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Open the app on the phone, before migration 0044 is run. Settings > Advanced | A "Unified Substrate" card: Database "Migration 0044 Not Applied", five rows "Not Ready", Flags "All Off". Nothing else on the screen moved. | Rendered through the real kit at 390px (preview folder); not opened on a phone | device |
| 2 | Run `jarvis-core/supabase/migrations/0044_jarvis_unified_substrate.sql` in the live project's SQL editor (after a backup), then reopen Settings > Advanced | Database "Migration 0044 Applied", five rows "Ready" | Proven on a local Postgres 16 only (`tests/substrate.sh`, 143 checks); the live project has not been touched | device |
| 3 | Use the app as before: Today, Life, Schedule, Email, Money | Nothing changed. No new tab, no new card anywhere but Advanced. | Full suite green, build green; no screen but Advanced touched | device |
| 4 | Settings > Backup > Export | The file still opens; nothing new inside it yet (no waiting or exploration rows exist) | `backup/entityRegistry.ts` carries the two new kinds; backup tests pass | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The fixtures hold synthetic ids; the private schema holds no values in this slice.
- [x] Anything visual was mocked and sent to Dave: the one visual change (the Advanced card) was rendered through the real kit and stylesheets at 390px in both themes and sent with this slice's report, before any merge. The bench that rendered it was deleted before the commit.
- [x] The laws pass: inside the tests stage, plus a new law (`src/laws/substrateBoundary.test.ts`) proven to bite on a planted violation.
- [x] No em dashes anywhere, including the copied package (72 normalised).
- [x] No demo data reaches a build: no seed or fixture is imported by app code; the SQL fixtures live under `supabase/tests/`.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [ ] Checked at 390 by 844 in both themes when a screen changed: rendered, not checked on a device.

## Previews

| File | Look at |
|---|---|
| advanced-missing-light.png | The card as Dave will first see it: Not Applied, five Not Ready rows |
| advanced-applied-light.png | After the migration: Applied, five Ready rows |
| advanced-missing-dark.png | Same, dark |
| advanced-applied-dark.png | Same, dark |

## What I would tell Dave in one line

Nothing on the phone changes until you run migration 0044, and the Advanced
card tells you whether you have.

## Notes

The phone rows stay open on purpose: this session has no device and no
database. The report reads `open` until Dave fills them.

**Result: open**
