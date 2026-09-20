# QA

The gate every change passes before it reaches Dave, and the evidence trail
that lets Clemenza review this repo without Dave relaying anything. Same
report shape as `jarvis-backend/qa` and `bridge-app/qa`, so `basecode-qa`
reads one format from every repo.

```
node qa/check.js                 # from the repo root
cd jarvis-app && npm run qa:check
QA_PUBLISH=0 node qa/check.js    # skip the push for one run
```

## What passing means

The stages are the ones docs/WORKFLOW_AND_GATE.md already agreed on and CI
runs, in that order, plus the house rules the laws do not cover.

| Stage | Command | Pass |
|---|---|---|
| core-types | `tsc --noEmit` in jarvis-core | exit 0 |
| core-tests | `vitest run` in jarvis-core, JSON reporter | failed 0, todo 0, skips match the baseline, every `tests/**/*.spec.ts` present with at least one assertion |
| app-types | `tsc --noEmit` in jarvis-app | exit 0 |
| app-lint | `eslint src` | exit 0; warnings counted and reported, never a failure (41 on 2026-09-20) |
| app-tests | `vitest run` in jarvis-app, JSON reporter, laws included | as core-tests, over every `*.test.*` and `*.spec.*` file in the package |
| app-build | `vite build` | exit 0 |
| app-legal | `npm run build:legal`, then `git diff jarvis-app/public` | no diff: the published legal pages match `src/legal/content.ts` |
| house | the standing rules | no new em dash anywhere in the repo, no secret shaped literal, no env file tracked, no `.only` |

Measured on 2026-09-20 before the gate was written: core tsc 5s, core tests
95 in 3s, app tsc 62s, eslint 16s, app tests 6495 in 566 files in 3m56s,
build 4s. About six minutes, almost all of it the suite.

A test file that throws on import is a failed suite with no assertions and
is named. A file that produced no tests is named. Skipped tests must match
`baseline.json` exactly per file: a skip nobody wrote down is a test that
stopped running.

## The human half

`manual` in the report is READ from the checklist, never assumed.
`manual.result` is `pass` only when a checklist's Commit line covers this
commit (HEAD, or HEAD's parent, since a checklist is committed with its
change) and its Result line says pass. Otherwise `provisional`, with the
reason. Provisional is not a pass.

`preview.applicable` is `false` unless a component or stylesheet under
`jarvis-app/src` was touched. Then it is `true` and the shots under
`qa/previews/<task>/` are listed, or `missing: true` says they are owed. The
shots come from the repo's own bench and `tools/visual-audit.mjs`, which the
gate does not run (see GAPS.md).

## Evidence matches what shipped

The report names `commit`, `commitFull`, `branch`, `dirty` and `onMain`.
Reports are not committed; they go to `basecode-qa` through `qa/publish.js`,
which refuses a report from a dirty tree and scans every byte it sends for
secret shapes, env values and a local deny list before it pushes. Sequence:
commit, run the gate clean, it publishes, fast forward merge, and `main` is
the commit the report names.

## baseline.json

Two ratchets, shrink only. Em dashes: a touched file must be zero whether or
not it is listed; an untouched listed file must match exactly; everything
else must be zero. Skips: per file, exact. Both start at what was measured
on 2026-09-20 and neither may go up.

## Files

```
qa/
  README.md            this
  GAPS.md              what the gate does not protect, with severity
  check.js             the gate, both packages, CI's order
  publish.js           pushes the artifacts to basecode-qa, gated on its own scan
  publish-deny.example what goes in the gitignored qa/publish-deny.txt
  baseline.json        em dash and skip debt, flat and shrink only
  checklists/          TEMPLATE.md plus one filled copy per change
  previews/            shots, one folder per change, when a screen changed
  reports/             gitignored, published not committed
```
