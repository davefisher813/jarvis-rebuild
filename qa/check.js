#!/usr/bin/env node
// qa/check.js, the gate every change passes before it reaches Dave.
//
// Same report shape as jarvis-backend/qa and bridge-app/qa, so basecode-qa
// reads one format from every repo. The stages are the ones this repo already
// agreed on in docs/WORKFLOW_AND_GATE.md and runs in CI, in that order, plus
// the house rules the laws do not cover. Stops at the first failure. Then the
// human half is READ from the checklist that covers the commit, and the whole
// thing is published.
//
// Measured before it was written (2026-09-20, this machine): core tsc 5s, core
// tests 95 in 3s, app tsc 62s, eslint 16s with 39 known warnings, app tests
// 6495 in 566 files in 3m56s (5 skipped by design, baselined), vite build 4s.
// About six minutes end to end, almost all of it the suite.
//
// Run: node qa/check.js            (or npm run qa:check inside jarvis-app)
//      QA_PUBLISH=0 node qa/check.js   to skip the push for one run

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(__dirname, 'reports');
const APP = path.join(ROOT, 'jarvis-app');
const CORE = path.join(ROOT, 'jarvis-core');

const read = (p) => fs.readFileSync(p, 'utf8');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const npx = (cwd, args, env = {}) => sh('npx', args, { cwd, env: { ...process.env, ...env } });

function git(...args) {
  const r = sh('git', args);
  return r.status === 0 ? r.stdout.trim() : null;
}

// Files this change touched: anything differing from origin/main, plus
// anything untracked. Touching a file costs it its em dash grandfathering.
function changedFiles() {
  const out = new Set();
  const hasBase = sh('git', ['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0;
  if (hasBase) {
    for (const f of (git('diff', '--name-only', 'origin/main', '--') || '').split('\n')) if (f.trim()) out.add(f.trim());
  }
  for (const f of (git('ls-files', '--others', '--exclude-standard') || '').split('\n')) if (f.trim()) out.add(f.trim());
  return out;
}

// The text files this repo tracks. git's own list, so an untracked scratch
// folder or a preview file is never judged and never grandfathered.
const TEXT_RE = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|sql|sh|py|txt|yml|yaml)$/;
function ownedFiles() {
  return (git('ls-files') || '').split('\n').filter((f) => f && TEXT_RE.test(f) && fs.existsSync(path.join(ROOT, f))).sort();
}

function baseline() {
  const p = path.join(__dirname, 'baseline.json');
  return fs.existsSync(p) ? JSON.parse(read(p)) : { emDash: {}, skips: {} };
}

// ── vitest, parsed ───────────────────────────────────────────────────────────
//
// vitest's own JSON reporter, never the exit code alone. Pass means zero
// failed, zero todo, every test file on disk present in the results with at
// least one assertion, and skipped tests matching the baseline exactly per
// file. A file that throws on import comes back as a failed suite with no
// assertions and is named; an empty file comes back with none and is named.

function testFilesOnDisk(dir, re, skipDirs) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (re.test(entry.name)) out.push(path.relative(ROOT, full));
    }
  };
  walk(dir);
  return out.sort();
}

function runVitest(name, cwd, onDisk, skipBaseline) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const out = path.join(REPORTS, `${name}.vitest.json`);
  const t0 = Date.now();
  const r = npx(cwd, ['vitest', 'run', '--reporter=json', `--outputFile=${out}`]);
  if (!fs.existsSync(out)) {
    return { name, result: 'fail', ms: Date.now() - t0, problems: ['vitest wrote no JSON report'], output: (r.stdout + r.stderr).trim().split('\n').slice(-30) };
  }
  const j = JSON.parse(read(out));
  const seen = new Map();
  const skippedPerFile = {};
  const failing = [];
  for (const t of j.testResults || []) {
    const rel = path.relative(ROOT, t.name);
    const as = t.assertionResults || [];
    seen.set(rel, as.length);
    for (const a of as) {
      if (a.status === 'failed') failing.push(`${a.fullName} (${rel})`);
      if (a.status === 'pending' || a.status === 'skipped' || a.status === 'todo') skippedPerFile[rel] = (skippedPerFile[rel] || 0) + 1;
    }
    if (t.status === 'failed' && !as.some((a) => a.status === 'failed')) {
      failing.push(`${rel} failed as a whole file (threw on import or in a hook): ${String(t.message || '').split('\n')[0]}`);
    }
  }
  const missing = onDisk.filter((f) => !seen.has(f));
  const empty = onDisk.filter((f) => seen.has(f) && seen.get(f) === 0);

  // Skips: exact match against the baseline, per file. A skip that is not
  // baselined is a test that stopped running and nothing said so.
  const skipProblems = [];
  for (const [f, n] of Object.entries(skippedPerFile)) {
    const b = skipBaseline[f];
    if (b === undefined) skipProblems.push(`${n} skipped in ${f}, not baselined`);
    else if (n !== b) skipProblems.push(`${n} skipped in ${f}, baseline records ${b}`);
  }
  for (const [f, b] of Object.entries(skipBaseline)) {
    if (seen.has(f) && !skippedPerFile[f]) skipProblems.push(`${f} is baselined for ${b} skips and skipped none, lower the baseline`);
  }

  const problems = [];
  if (!j.success || j.numFailedTests) problems.push(`${j.numFailedTests || failing.length} failing`);
  if (j.numTodoTests) problems.push(`${j.numTodoTests} todo`);
  problems.push(...skipProblems);
  if (missing.length) problems.push(`${missing.length} test file(s) on disk produced no result: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}`);
  if (empty.length) problems.push(`${empty.length} test file(s) ran no tests: ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? ' ...' : ''}`);

  return {
    name,
    result: problems.length ? 'fail' : 'pass',
    ms: Date.now() - t0,
    counts: { pass: j.numPassedTests, fail: j.numFailedTests, skipped: j.numPendingTests, todo: j.numTodoTests, filesOnDisk: onDisk.length, filesInResults: seen.size, filesWithTests: onDisk.length - missing.length - empty.length },
    skippedPerFile,
    filesNotLoaded: missing,
    filesWithNoTests: empty,
    failing: failing.slice(0, 50),
    problems
  };
}

// ── the stages, in the order CI runs them ────────────────────────────────────

function stageCommand(name, cwd, args, opts = {}) {
  const t0 = Date.now();
  const r = npx(cwd, args, opts.env || {});
  const lines = (r.stdout + r.stderr).split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const stage = { name, result: r.status === 0 ? 'pass' : 'fail', ms: Date.now() - t0 };
  if (opts.warnings) stage.warnings = lines.filter((l) => /warning/i.test(l)).length;
  if (r.status !== 0) stage.errors = lines.filter((l) => /error/i.test(l)).slice(0, 40).concat(lines.length ? [] : ['(no output)']);
  return stage;
}

const SKIP = new Set(['node_modules', 'dist', '.git']);

function stageCoreTypes() { return stageCommand('core-types', CORE, ['tsc', '--noEmit']); }
function stageCoreTests(b) { return runVitest('core-tests', CORE, testFilesOnDisk(path.join(CORE, 'tests'), /\.spec\.ts$/, SKIP), b.skips || {}); }
function stageAppTypes() { return stageCommand('app-types', APP, ['tsc', '--noEmit']); }
// eslint: warnings are counted and reported, never a failure. 39 unused
// eslint-disable directives are known (docs/WORKFLOW_AND_GATE.md); the count
// is in the report so a 40th is visible without failing unrelated work.
function stageAppLint() { return stageCommand('app-lint', APP, ['eslint', 'src'], { warnings: true }); }
function stageAppTests(b) { return runVitest('app-tests', APP, testFilesOnDisk(APP, /\.(test|spec)\.[cm]?[jt]sx?$/, SKIP), b.skips || {}); }
function stageAppBuild() { return stageCommand('app-build', APP, ['vite', 'build']); }

// build:legal regenerates the published legal pages from src/legal/content.ts.
// A diff under jarvis-app/public afterwards means the source was edited and
// the pages were not, which is how the app and the App Store's linked policy
// drifted apart once (docs/WORKFLOW_AND_GATE.md).
function stageAppLegal() {
  const t0 = Date.now();
  const r = sh('npm', ['run', 'build:legal'], { cwd: APP });
  if (r.status !== 0) return { name: 'app-legal', result: 'fail', ms: Date.now() - t0, errors: (r.stdout + r.stderr).trim().split('\n').slice(-20) };
  const diff = sh('git', ['diff', '--name-only', '--', 'jarvis-app/public']);
  const changed = (diff.stdout || '').trim().split('\n').filter(Boolean);
  return { name: 'app-legal', result: changed.length ? 'fail' : 'pass', ms: Date.now() - t0, regenerated: changed, problems: changed.length ? ['legal pages under jarvis-app/public differ from src/legal/content.ts: regenerate and commit them'] : [] };
}

// ── the house rules ──────────────────────────────────────────────────────────

const EM_DASH = new RegExp(String.fromCharCode(0x2014), 'g');
const SECRET_PATTERNS = [
  { rule: 'jwt-literal', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { rule: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'anthropic-or-openai-key', re: /\bsk-(ant-)?[A-Za-z0-9_-]{24,}/ },
  { rule: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { rule: 'env-assignment', re: /^\s*[A-Z][A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S{8,}\s*$/m }
];

function stageHouse(b) {
  const findings = [];
  const files = ownedFiles();
  const touched = changedFiles();
  const base = b.emDash || {};
  const burndown = [];

  // Rule 1: em dashes, the ratchet. A touched file must be ZERO whether or not
  // it is baselined; an untouched baselined file must match exactly; anything
  // else must be zero.
  for (const f of files) {
    const n = (read(path.join(ROOT, f)).match(EM_DASH) || []).length;
    const recorded = base[f];
    if (touched.has(f)) {
      if (n > 0) findings.push({ rule: 'no-em-dash', file: f, detail: recorded !== undefined ? `${n} em dashes in a file this change touched. A baselined file loses its grandfathering the moment you edit it.` : `${n} em dashes in a file this change touched.` });
    } else if (recorded !== undefined) {
      if (n > recorded) findings.push({ rule: 'no-em-dash', file: f, detail: `${n} em dashes, baseline records ${recorded}, so ${n - recorded} were added.` });
      else if (n < recorded) burndown.push({ file: f, was: recorded, now: n });
    } else if (n > 0) {
      findings.push({ rule: 'no-em-dash', file: f, detail: `${n} em dashes.` });
    }
  }

  // Rule 2: no secret shaped literal, no env file tracked. .env.example is the
  // documented list of names and is allowed.
  for (const f of files) {
    if (/\.example$/.test(f)) continue;
    const body = read(path.join(ROOT, f));
    for (const p of SECRET_PATTERNS) if (p.re.test(body)) findings.push({ rule: 'no-secret-in-source:' + p.rule, file: f, detail: 'matched a secret shaped literal; the value is not printed' });
  }
  for (const f of (git('ls-files') || '').split('\n')) {
    if (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !/\.example$/.test(f)) findings.push({ rule: 'no-env-file-tracked', file: f, detail: 'an env file is tracked by git' });
  }

  // Rule 3: no .only, which would hide every other test in the file.
  for (const f of files.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))) {
    if (/\b(it|test|describe)\.only\(/.test(read(path.join(ROOT, f)))) findings.push({ rule: 'no-only', file: f, detail: '.only would hide every other test in the file' });
  }

  return {
    name: 'house',
    result: findings.length ? 'fail' : 'pass',
    findings,
    baselined: base,
    baselineTotal: Object.values(base).reduce((a, n) => a + n, 0),
    burndown,
    touchedFiles: touched.size
  };
}

// ── the human half, read rather than assumed ─────────────────────────────────

function checklistCommit(file) {
  const body = read(path.join(__dirname, 'checklists', file));
  return {
    commit: (/^Commit:\s*([0-9a-f]{7,40})/m.exec(body) || [])[1] || null,
    stated: ((/\*\*Result:\s*([a-z]+)/i.exec(body) || [])[1] || 'unfilled').toLowerCase()
  };
}

function checklists() {
  const dir = path.join(__dirname, 'checklists');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md' && /^\d{4}-\d{2}-\d{2}-/.test(f));
}

function newestChecklist() {
  const dir = path.join(__dirname, 'checklists');
  const files = checklists()
    .map((f) => ({ f, day: f.slice(0, 10), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, c) => a.day.localeCompare(c.day) || a.mtime - c.mtime);
  return files.length ? files[files.length - 1].f : null;
}

function checklistFor(head) {
  const parent = git('rev-parse', '--short', 'HEAD~1');
  const covering = checklists().filter((f) => {
    const c = checklistCommit(f).commit;
    return c && (head.startsWith(c) || (parent && parent.startsWith(c)));
  }).sort();
  return covering.length ? covering[covering.length - 1] : newestChecklist();
}

function manualVerdict(head) {
  const file = checklistFor(head);
  if (!file) return { checklist: null, result: 'provisional', reason: 'no filled checklist in qa/checklists' };
  const { commit, stated } = checklistCommit(file);
  const parent = git('rev-parse', '--short', 'HEAD~1');
  const covers = commit && (head.startsWith(commit) || (parent && parent.startsWith(commit)));
  let result, reason;
  if (!covers) { result = 'provisional'; reason = `${file} is for commit ${commit || 'unknown'}, not this one`; }
  else if (stated === 'pass') { result = 'pass'; reason = `${file} covers this commit and says pass`; }
  else if (stated === 'fail') { result = 'fail'; reason = `${file} covers this commit and says FAIL`; }
  else { result = 'provisional'; reason = `${file} covers this commit but its Result line says ${stated}`; }
  return { checklist: 'qa/checklists/' + file, checklistCommit: commit, checklistSays: stated, result, reason };
}

// A screen change is a component or a stylesheet under jarvis-app/src. Shots
// are then expected under qa/previews/<task>/, from the repo's own bench and
// visual audit tools, which this gate does not run (GAPS.md).
function previewStatus(touched) {
  const ui = [...touched].filter((f) => /^jarvis-app\/src\/.*\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) || /^jarvis-app\/src\/.*\.css$/.test(f));
  if (!ui.length) return { applicable: false, reason: 'no screen or stylesheet touched', files: [] };
  const file = checklistFor(git('rev-parse', '--short', 'HEAD') || '');
  const task = file ? file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') : null;
  const dir = task ? path.join(__dirname, 'previews', task) : null;
  const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => `qa/previews/${task}/${f}`) : [];
  return { applicable: true, reason: `touched ${ui.slice(0, 5).join(', ')}${ui.length > 5 ? ` and ${ui.length - 5} more` : ''}`, files, missing: files.length === 0 };
}

// ── run ──────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const pkg = JSON.parse(read(path.join(APP, 'package.json')));
  const b = baseline();
  const stages = [];

  const order = [
    stageCoreTypes, () => stageCoreTests(b),
    stageAppTypes, stageAppLint, () => stageAppTests(b), stageAppBuild, stageAppLegal,
    () => stageHouse(b)
  ];
  for (const runStage of order) {
    const stage = await runStage();
    stages.push(stage);
    process.stdout.write(`${stage.result === 'pass' ? 'PASS' : 'FAIL'}  ${stage.name}${stage.ms ? `  ${stage.ms}ms` : ''}${stage.warnings ? `  ${stage.warnings} warning(s)` : ''}\n`);
    if (stage.result === 'fail') {
      for (const p of stage.problems || []) process.stdout.write(`  ${p}\n`);
      for (const f of (stage.failing || []).slice(0, 20)) process.stdout.write(`  FAIL ${f}\n`);
      for (const f of stage.findings || []) process.stdout.write(`  ${f.rule}  ${f.file}: ${f.detail}\n`);
      for (const e of (stage.errors || []).slice(0, 10)) process.stdout.write(`  ${e}\n`);
      break;
    }
  }

  const failed = stages.some((s) => s.result === 'fail');
  const head = git('rev-parse', '--short', 'HEAD');
  const touched = changedFiles();

  const report = {
    repo: 'jarvis-rebuild',
    version: pkg.version,
    commit: head,
    commitFull: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: (git('status', '--porcelain') || '') !== '',
    onMain: sh('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']).status === 0,
    startedAt,
    durationMs: Date.now() - t0,
    result: failed ? 'fail' : 'pass',
    stagesNotRun: order.length - stages.length,
    stages,
    manual: manualVerdict(head),
    preview: previewStatus(touched)
  };

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(REPORTS, startedAt.replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2) + '\n');

  process.stdout.write(`\n${report.result.toUpperCase()}  ${report.commit || 'no commit'}${report.dirty ? ' (dirty tree)' : ''}${report.onMain ? ' on main' : ''}  ${report.durationMs}ms\n`);
  process.stdout.write(`manual: ${report.manual.result}, ${report.manual.reason}\n`);
  if (report.preview.applicable && report.preview.missing) process.stdout.write('preview: a screen or stylesheet was touched and no shots were found under qa/previews\n');
  if (report.stagesNotRun) process.stdout.write(`stopped early, ${report.stagesNotRun} stage(s) not run\n`);
  process.stdout.write('qa/reports/latest.json\n');
  if (report.result === 'pass' && report.manual.result !== 'pass') {
    process.stdout.write('\nNot done yet: fill a checklist from qa/checklists/TEMPLATE.md for this commit.\n');
  }

  // The evidence leaves for basecode-qa, pass or fail. The publisher gates
  // itself on a secret scan and refuses a dirty tree; its outcome is printed,
  // not folded into this exit code.
  if (process.env.QA_PUBLISH !== '0') {
    process.stdout.write('\n');
    const pub = sh(process.execPath, [path.join(__dirname, 'publish.js')], { stdio: 'inherit' });
    if (pub.status !== 0) process.stdout.write('(the gate result above is unchanged by this)\n');
  }
  process.exit(report.result === 'pass' ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write('qa:check crashed: ' + (e && e.stack ? e.stack : e) + '\n');
  process.exit(1);
});
