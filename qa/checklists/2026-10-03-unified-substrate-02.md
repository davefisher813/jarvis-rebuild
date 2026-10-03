# Manual check: the unified substrate, slice 02 (authorization, scoped context and the gateway)

Commit: 25e3813 (HEAD before the slice 02 commit, which lands on top of it)
Date: 2026-10-03
Checked by: Claude Code, in the repo
QA report: `QA_PUBLISH=0 node qa/check.js`, not published
Preview: not applicable, no screen (the Hub screens are slice 04)

**What Dave asked for, in his words:** "work through the 9 sequenced prompts in JARVIS-Unified/prompts/ in order (01 through 09) - each is self-contained."

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Use the app as before: Today, Life, Schedule, Email, Money, Settings | Nothing changed. No new tab, no new card, no new copy. | No component touched in this slice; full suite green, build green | device |
| 2 | On the live project, after 0044 and 0045 are applied: `select substrate_readiness();` in the SQL editor | Still answers the seven kinds; nothing in the app behaves differently | Proven locally only; the live project is untouched | device |
| 3 | Call `POST /api/agent` on the deployed site with no token | 401 with `{code: "AUTH_REQUIRED", safe_message, retryable, correlation_id}` and nothing else | Proven by `handler.test.ts`; not deployed in this session | device |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The gateway logs a status, a code and a correlation id, never a body or a token; tokens exist in the database as hashes only.
- [x] Anything visual was mocked first: nothing visual in this slice.
- [x] The laws pass: inside the tests stage, with two roster entries added and their reasons written (the gateway is a route; two modules wait for their screens in slices 04 and 05).
- [x] No em dashes.
- [x] No demo data reaches a build.
- [x] Nothing pushed to GitHub except by Claude Code on Dave's word: pushed to the working branch only, as he asked; no merge.
- [x] Nothing at phone width to check.

## What I would tell Dave in one line

An outside assistant can now be given exactly one project's brief, for fifteen minutes, with a receipt, and can only ever propose; nothing it sends back is saved until you tap.

## Notes

The phone rows stay open on purpose: no device and no deployment in this
session. Rows 2 and 3 are the two live checks that would prove the deploy.

**Result: open**
