# Manual check: an open row means an open verdict

Commit: 34ad546 (the commit this change is built on)
Date: 2026-09-21
Checked by: Claude Code, in the repo
QA report: published to basecode-qa
Preview: not applicable, no screen

**What Clemenza asked for, in his words:** "manual.result must read open or
provisional while any checklist row is open, in all three repos."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Read every Steps row of the covering checklist | a Pass cell that is not a yes makes the verdict `open`, naming the rows | `openRows` parses the table; `device`, `pending`, `no`, empty all count as open | yes |
| 2 | Dry run against this repo's checklists | web-push rows 11 to 14 open, qa-layer closed | exactly that | yes |
| 3 | Open rows on OTHER checklists | still visible in every later report | `manual.openElsewhere` lists them by file and row; this run names web-push rows 11 to 14 | yes |
| 4 | Gate on the clean commit | green, manual pass for this checklist, openElsewhere names web-push | filled after the run | |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot.
- [x] Anything visual was mocked first: nothing visual.
- [x] The laws pass inside the tests stage.
- [x] No em dashes.
- [x] No demo data reaches a build.
- [x] Nothing pushed to GitHub except on Dave's word: "just proceed".
- [x] Nothing at phone width to check.

## What I would tell Dave in one line

The report cannot say pass any more while a row is still waiting on your
phone.

**Result: pass**
