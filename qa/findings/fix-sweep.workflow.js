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
    needs_dave: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, question: { type: 'string' } }, required: ['id', 'question'] } },
    needs_other_file: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, file: { type: 'string' }, change: { type: 'string' } }, required: ['id', 'file', 'change'] } },
    blocked_by_law: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, law: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'law', 'why'] } },
    checks: { type: 'string', description: 'exact commands run and their result lines' },
  },
  required: ['applied', 'rejected', 'needs_dave', 'needs_other_file', 'blocked_by_law', 'checks'],
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
  4. If the only fix deletes or rewords user-facing text, do NOT apply it; put
     it in "needs_dave" with a one-line question Dave can answer yes/no.
  5. If it needs a file you do not own, put it in "needs_other_file".
  6. If a test in src/laws/ blocks a correct fix, do not edit the law; put it
     in "blocked_by_law".

Then check your work, and report the exact commands and result lines:
  - cd ${ROOT}/jarvis-app && npx tsc --noEmit 2>&1 | grep -E "${g.files.map((f) => f.split('/').pop()).join('|')}" || echo "no errors in my files"
    (other agents are editing other files at the same time; errors elsewhere are not yours)
  - npx vitest run <your files' test files and their directories>
  - ${g.files.some((f) => f.endsWith('.css')) ? 'npx vitest run src/laws/   (many laws pin stylesheet text)' : 'npx vitest run src/laws/ if you changed anything a law could read'}
Fix any failure your change caused before you finish.`

const reviewPrompt = (lens, phase) => `Read ${RULES} in full first.

A sweep just applied Colour Key fixes (phase: ${phase}). Review the working-tree
diff with an ADVERSARIAL eye, through this lens only: ${lens}

Run: cd ${ROOT} && git diff -- jarvis-app/src
Look for anything that is now WRONG: a fix that broke the rule it was fixing,
introduced a second grey or a meaningless colour elsewhere on the same row,
used a new class instead of a primitive, touched the schedule or Today card,
changed user-facing wording, broke a layout (a wrapped or clipped line, a
lost tap target), or will break a law (grep src/laws/ for the selector or
string). Default to reporting only what you can show from the diff and the
code. Do not edit anything.`

const LENSES = [
  'R1/R5 one grey per row: count the grey runs on every row the diff touches, as rendered',
  'R3 the colour key: every colour the diff adds or changes must mean exactly what the key says',
  'R2/R7/R8/R9/R10 capsule, sizes, dates, field notes, section heads: primitives used, nothing invented',
  'Regressions: layout, tap targets, copy, the schedule, and every law in src/laws/',
]

phase('Fix')
const groups = (args && args.groups) || []
if (!groups.length) { log('No groups passed in args; nothing to do.'); return { reports: [], issues: [] } }
let reports
if (args.sequential) {
  reports = []
  for (const g of groups) {
    reports.push(await agent(fixPrompt(g), { label: 'fix:' + g.label, phase: 'Fix', schema: REPORT })
      .then((r) => r && { ...r, label: g.label }))
  }
} else {
  reports = await parallel(groups.map((g) => () =>
    agent(fixPrompt(g), { label: 'fix:' + g.label, phase: 'Fix', schema: REPORT })
      .then((r) => r && { ...r, label: g.label })))
}
const ok = reports.filter(Boolean)
const dead = groups.length - ok.length
if (dead) log(`${dead} group(s) returned nothing -- rerun them by label`)
const tally = (k) => ok.reduce((n, r) => n + (r[k] || []).length, 0)
log(`applied ${tally('applied')}, rejected ${tally('rejected')}, needs_dave ${tally('needs_dave')}, needs_other_file ${tally('needs_other_file')}, blocked_by_law ${tally('blocked_by_law')}`)

phase('Review')
const reviews = await parallel(LENSES.map((lens, i) => () =>
  agent(reviewPrompt(lens, args.phase), { label: 'review:' + i, phase: 'Review', schema: ISSUES })))
const issues = reviews.filter(Boolean).flatMap((r) => r.issues || [])

return {
  phase: args.phase,
  deadGroups: groups.filter((g) => !ok.find((r) => r.label === g.label)).map((g) => g.label),
  reports: ok,
  issues,
}
