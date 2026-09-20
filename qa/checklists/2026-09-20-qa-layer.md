# Manual check: the QA layer and the evidence trail

Commit: 98a0aaf (the commit this change is built on; the change itself is the next commit)
Date: 2026-09-20
Checked by: Claude Code, in the repo
QA report: published to basecode-qa
Preview: not applicable, no screen

**What Clemenza asked for, in his words:** "QA layer for jarvis-rebuild is
step zero and ships as its own commit, gated and published under
jarvis-rebuild/ in basecode-qa, BEFORE any push code. Do not combine them."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Baseline the repo's own commands before writing the gate | Numbers, not guesses | core tsc 5s, core tests 95 in 3s, app tsc 62s, eslint 16s exit 0, app tests 6495 in 566 files in 3m56s with 5 skipped, vite build 4s | yes |
| 2 | Read what the repo already calls its gate | Mirror it, add nothing it did not agree to | docs/WORKFLOW_AND_GATE.md: the eight commands in CI's order, including build:legal plus the public diff. All eight are stages, same order | yes |
| 3 | `QA_PUBLISH=0 node qa/check.js` on the untouched tree | Seven stages pass; the house stage reports the repo's real debt | Seven PASS. House FAILED on two files a hand grep had missed: a tracked handoff note with a space in its folder name, 127 em dashes, and one SQL migration comment, 1. Both baselined; the gate found what the survey did not | yes |
| 4 | Plant a spec that throws on import in jarvis-core, rerun | Tests stage fails and names the file, later stages do not run | "1 failing", "1 test file(s) ran no tests: jarvis-core/tests/zz-throws.spec.ts", the failed-as-a-whole-file line with the import error, "stopped early, 6 stage(s) not run". Removed, green again | yes |
| 5 | Skipped tests | Match the baseline exactly per file | 5 in tools/ai-harness.test.ts, `describe.skipIf(!LIVE)`, baselined with the reason. Any sixth fails the stage | yes |
| 6 | Confirm no env file is tracked and no secret literal exists | Nothing but `.env.example` | `git ls-files` has `jarvis-app/.env.example` only, allowed by name; no secret shaped literal in 1632 tracked text files | yes |
| 7 | Commit, run clean, publish | `dirty: false`, manual `pass`, folder `jarvis-rebuild/2026-09-20-qa-layer/` in basecode-qa | All eight stages PASS in 302s, `dirty: false`, `onMain: false`, manual `pass` "covers this commit and says pass", scan clean, published with report.json, checklist.md, gaps.md | yes |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The
      publisher's refusals print rule names and entry numbers only.
- [x] Anything visual was mocked first. No screen changed.
- [x] The laws pass: they are inside the app-tests stage, 6490 passing.
- [x] No em dashes anywhere in the new files, checked by the gate itself.
- [x] No demo data reaches a build: unchanged, the law still checks it.
- [x] Nothing pushed to GitHub except on Dave's word. The branch is local
      until he says so. Publishing artifacts to basecode-qa is not a push of
      this repo.
- [x] Nothing at phone width to check: no screen changed.

## What I would tell Dave in one line

The app has the same gate as the backend and the Bridge app now, it is the
eight checks the repo already agreed on, and Clemenza can read its evidence
without you.

## Notes

**ESLint says 41 warnings, the workflow doc says 39.** Counted, reported,
not failed, and the doc's number is now stale by two. Not fixed here: the
doc says not to fix them as part of unrelated work.

**The gate found debt the survey missed.** A folder name with a space broke
the hand grep; `git ls-files` does not care. The baseline was written from
the gate's own first run, which is the right order.

**Six minutes a run, almost all of it the suite.** That is the repo's own
cost, not the gate's; CI pays the same.

**Result: pass**
