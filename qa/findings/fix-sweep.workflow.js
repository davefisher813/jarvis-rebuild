export const meta = {
  name: 'colour-key-fix-sweep',
  description: 'Verify and apply saved Colour Key findings, one agent per file group, then adversarially review the diff',
  whenToUse: 'Resuming the 2026-09-22 sweep. Run once per phase (css, code, middots) with args built from qa/findings/2026-09-22-work-plan.json',
  phases: [
    { title: 'Fix', detail: 'one agent per stylesheet batch or file group; verify each finding, apply the real ones' },
    { title: 'Review', detail: 'independent reviewers attack the combined diff by rule family' },
  ],
}

// ARGS (built by the lead session, see qa/findings/2026-09-22-RESUME.md):
//   { phase: "css" | "code" | "middots",
//     groups: [{ label, files: [..], finding_ids: [..] }],
//     sequential: boolean }   // true for css: batches of ONE stylesheet must not run at once
//
// Agents have file access; this script does not. So findings are passed by id
// and each agent reads qa/findings/2026-09-22-colour-key-sweep.json itself.

const ROOT = '/home/user/jarvis-rebuild'
const RULES = `${ROOT}/qa/findings/RULEBOOK.md`
const FINDINGS = `${ROOT}/qa/findings/2026-09-22-colour-key-sweep.json`

const REPORT = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, file: { type: 'string' }, what: { type: 'string' } }, required: ['id', 'what'] } },
    rejected: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    reworded: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, file: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['id', 'old', 'new'] } },
    needs_dave: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, question: { type: 'string' } }, required: ['id', 'question'] } },
    needs_other_file: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, file: { type: 'string' }, change: { type: 'string' } }, required: ['id', 'file', 'change'] } },
    blocked_by_law: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, law: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'law', 'why'] } },
    checks: { type: 'string', description: 'exact commands run and their result lines' },
  },
  required: ['applied', 'rejected', 'reworded', 'needs_dave', 'needs_other_file', 'blocked_by_law', 'checks'],
}

const ISSUES = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, line: { type: 'integer' }, problem: { type: 'string' },
      severity: { type: 'string', enum: ['breaks', 'wrong', 'inconsistent', 'nit'] },
      fix: { type: 'string' } }, required: ['file', 'problem', 'severity'] } },
  },
  required: ['issues'],
}

const fixPrompt = (g) => `Read ${RULES} in full first. It is the rulebook; follow it exactly, including
its "Hard limits for any agent that edits".

You own these files and ONLY these files: ${g.files.join(', ')}
(plus their co-located *.test.ts(x) files, if a fix intentionally changes what they assert).

Your findings are the entries in ${FINDINGS} whose "id" is one of:
${JSON.stringify(g.finding_ids)}

These findings are UNVERIFIED and were written against the code as it stood on
2026-09-22. For EACH one:
  1. Open the code as it is NOW. Trace what actually renders: the class at the
     call site, the cascade (later rules, .ruled and theme overrides win), and
     whether the runs are really on the same row.
  2. If it is not real now (already fixed, never real, or covered by a "Known
     legitimate" item), put it in "rejected" with the reason.
  3. If it is real and the fix only restyles, apply it using the PRIMITIVES
     table -- the finding's own "fix" text is a suggestion, not an order;
     prefer the primitive when they differ.
  4. Rewording is allowed (Dave: "Reword freely"). If the best fix rewords or
     drops a redundant fact, apply it and list it in "reworded" as the exact
     old and new text. Use "needs_dave" only for a genuine product decision
     (behaviour, not wording).
  5. If it needs a file you do not own, put it in "needs_other_file".
  6. If a test in src/laws/ blocks a correct fix, do not edit the law; put it
     in "blocked_by_law".

Then check your work, and report the exact commands and result lines:
  - cd ${ROOT}/jarvis-app && npx tsc --noEmit 2>&1 | grep -E "${g.files.map((f) => f.split('/').pop()).join('|')}" || echo "no errors in my files"
    (other agents are editing other files at the same time; errors elsewhere are not yours)
  - npx vitest run <your files' test files and their directories>
  - ${g.files.some((f) => f.endsWith('.css')) ? 'npx vitest run src/laws/   (many laws pin stylesheet text)' : 'npx vitest run src/laws/ if you changed anything a law could read'}
Fix any failure your change caused before you finish.`

const reviewPrompt = (lens, phase) => `Read ${RULES} in full first (its "Settled by the lead" and "Held for Dave" sections are not problems).

A sweep just applied Colour Key fixes (phase: ${phase}). Review the working-tree
diff with an ADVERSARIAL eye, through this lens only: ${lens}

Run: cd ${ROOT} && git diff ${(args && args.base) || 'HEAD'} -- jarvis-app/src   (the phase's whole change: committed checkpoints plus the working tree)
Look for anything that is now WRONG: a fix that broke the rule it was fixing,
introduced a second grey or a meaningless colour elsewhere on the same row,
used a new class instead of a primitive, changed the Today TV guide's
BEHAVIOUR (scrolling, pausing, when it renders -- styling its rows is allowed),
reworded text in a way that changes its MEANING (rewording itself is allowed),
broke a layout (a wrapped or clipped line, a lost tap target), or will break a
law (grep src/laws/ for the selector or string). Report only defects the diff
introduced or left half-done (a conversion it started and did not finish, a rule
with no markup or markup with no rule); a pre-existing violation on a row the diff
did not touch is out of scope (it is either a pending finding or a later audit's).
Default to reporting only what you can show from the diff and the code. Do not
edit anything.`

const LENSES = [
  'R1/R5 one grey per row: count the grey runs on every row the diff touches, as rendered',
  'R3 the colour key: every colour the diff adds or changes must mean exactly what the key says',
  'R2/R7/R8/R9/R10 capsule, sizes, dates, field notes, section heads: primitives used, nothing invented',
  'Regressions: layout, tap targets, meaning of reworded copy, TV guide behaviour, and every law in src/laws/',
  'Light theme and sheets: every text colour the diff changed, against the grounds it sits on in light and dark (page, card, sheet grey, toast, tinted banner); under 4.5:1 is a problem unless it is --good, --warn or --sys-red in light (Dave accepted those as shipped)',
  'Completeness: for every finding id the fixers reported applied, open the code and confirm the change is really there and whole (markup AND the rule it needs); for every rejected id, check the reason holds',
]

// args.noReview: fix only (two fix runs side by side, one review after both).
// args.reviewOnly: skip Fix and review the working-tree diff (groups ignored).
const reviewOnly = !!(args && args.reviewOnly)
phase('Fix')
const groups = reviewOnly ? [] : (args && args.groups) || []
if (!groups.length && !reviewOnly) { log('No groups passed in args; nothing to do.'); return { reports: [], issues: [] } }
let reports = []
if (reviewOnly) {
  log('review only')
} else if (args.sequential) {
  // One file never has two agents at once: batches of the SAME stylesheet run
  // in order, while different stylesheets run side by side.
  const chains = {}
  for (const g of groups) (chains[g.files[0]] = chains[g.files[0]] || []).push(g)
  const perChain = await parallel(Object.values(chains).map((chain) => async () => {
    const out = []
    for (const g of chain) {
      out.push(await agent(fixPrompt(g), { label: 'fix:' + g.label, phase: 'Fix', schema: REPORT })
        .then((r) => r && { ...r, label: g.label }))
    }
    return out
  }))
  reports = perChain.filter(Boolean).flat()
} else {
  reports = await parallel(groups.map((g) => () =>
    agent(fixPrompt(g), { label: 'fix:' + g.label, phase: 'Fix', schema: REPORT })
      .then((r) => r && { ...r, label: g.label })))
}
const ok = reports.filter(Boolean)
const dead = groups.length - ok.length
if (dead) log(`${dead} group(s) returned nothing -- rerun them by label`)
const tally = (k) => ok.reduce((n, r) => n + (r[k] || []).length, 0)
log(`applied ${tally('applied')}, rejected ${tally('rejected')}, reworded ${tally('reworded')}, needs_dave ${tally('needs_dave')}, needs_other_file ${tally('needs_other_file')}, blocked_by_law ${tally('blocked_by_law')}`)

if (args && args.noReview) {
  return { phase: args.phase, deadGroups: groups.filter((g) => !ok.find((r) => r.label === g.label)).map((g) => g.label), reports: ok, issues: [], deadReviews: [] }
}

phase('Review')
const reviews = await parallel(LENSES.map((lens, i) => () =>
  agent(reviewPrompt(lens, args.phase), { label: 'review:' + i, phase: 'Review', schema: ISSUES })))
const issues = reviews.filter(Boolean).flatMap((r) => r.issues || [])
const deadReviews = reviews.map((r, i) => (r ? null : i)).filter((i) => i !== null)
if (deadReviews.length) log('review lenses that returned nothing (rerun them): ' + deadReviews.join(', '))

return {
  phase: args.phase,
  deadGroups: groups.filter((g) => !ok.find((r) => r.label === g.label)).map((g) => g.label),
  deadReviews,
  reports: ok,
  issues,
}
