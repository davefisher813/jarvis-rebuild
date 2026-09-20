# Manual check: <change title>

Copy this file to `qa/checklists/YYYY-MM-DD-<change>.md`, fill it, commit it
with the change.

**A green `qa:check` with a red checklist is a FAIL.** The machine stages
prove the code runs. Only this proves the thing Dave asked for actually
exists on his phone. An unfilled checklist counts as red, and the report says
`provisional` until a checklist covers the commit and says pass.

Commit: <the commit this change is built on; HEAD before you commit>
Date: <ISO>
Checked by: <name>
QA report: published to basecode-qa
Preview: qa/previews/<change>/ , or "not applicable, no screen"

**What Dave asked for, in his words:** "<quote him, do not paraphrase>"

## Steps

Write the steps someone would actually take on the phone, from the Home
Screen app, not the code path. Fill Actual by doing it, not by reading the
diff.

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## The standing rules

Tick each one and say how it was checked. An unticked box is a fail, not a
note for later.

- [ ] No secret printed, logged, committed, or visible in any screenshot.
      Keys live in Vercel and Codemagic, never here.
- [ ] Anything visual was mocked and sent to Dave before it was built, and
      the preview pinned its text size.
- [ ] The laws pass: `npx vitest run src/laws` is inside the tests stage.
- [ ] No em dashes anywhere, including code comments and strings.
- [ ] No demo data reaches a build: the build strips it, the law checks it.
- [ ] Nothing pushed to GitHub except by Claude Code on Dave's word.
- [ ] Checked at 390 by 844 in both themes when a screen changed.

## Previews

Only for a change with a screen. Attach the shots at 390px, both themes, and
say what to look at in each.

| File | Look at |
|---|---|
| | |

## What I would tell Dave in one line

<the thing he needs to know before he opens it, or "nothing, it just works">

## Notes

<anything surprising, anything deferred, anything you were unsure about>

**Result: pass / fail**
