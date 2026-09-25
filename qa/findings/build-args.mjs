// Builds the `args` for fix-sweep.workflow.js from the saved plan.
//
//   node qa/findings/build-args.mjs css      > /tmp/args-css.json
//   node qa/findings/build-args.mjs code     > /tmp/args-code.json
//   node qa/findings/build-args.mjs middots  > /tmp/args-middots.json
//
// Only findings still "pending" are included, and any marked needs_dave are
// held back (they go to Dave first). Re-run after updating statuses and it
// picks up where the last run stopped.
import { readFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const plan = JSON.parse(readFileSync(dir + "2026-09-22-work-plan.json", "utf8"));
const findings = JSON.parse(readFileSync(dir + "2026-09-22-colour-key-sweep.json", "utf8"));
const byId = new Map(findings.map((f) => [f.id, f]));
const live = (ids) => ids.filter((id) => byId.get(id)?.status === "pending" && !byId.get(id)?.needs_dave);

const phase = process.argv[2];
let groups = [];
let sequential = false;

if (phase === "css") {
  // One stylesheet must never have two agents at once, so every css batch
  // runs in sequence. Batches of 20 keep each agent's job reviewable.
  sequential = true;
  for (const [sheet, ids] of Object.entries(plan.css_by_sheet)) {
    const l = live(ids);
    for (let i = 0; i < l.length; i += 20) {
      groups.push({ label: `${sheet}#${i / 20 + 1}`, files: [`jarvis-app/src/styles/${sheet}`], finding_ids: l.slice(i, i + 20) });
    }
  }
} else if (phase === "all-code") {
  // Code and separator findings together, one agent per file group: groups
  // from both lists that share a file are merged so no file has two agents.
  const src = [...plan.code_groups, ...plan.middot_groups].map((g) => ({ files: new Set(g.files), ids: [...g.finding_ids] }));
  const merged = [];
  for (const g of src) {
    const hits = merged.filter((m) => [...g.files].some((f) => m.files.has(f)));
    const into = { files: new Set(g.files), ids: [...g.ids] };
    for (const h of hits) { h.files.forEach((f) => into.files.add(f)); into.ids.push(...h.ids); merged.splice(merged.indexOf(h), 1); }
    merged.push(into);
  }
  merged.forEach((g, i) => {
    const l = live(g.ids);
    const files = [...g.files].sort();
    if (l.length) groups.push({ label: `code-${i + 1}:${files[0].split("/").pop()}`, files: files.map((f) => "jarvis-app/" + f), finding_ids: l });
  });
} else if (phase === "code" || phase === "middots") {
  const src = phase === "code" ? plan.code_groups : plan.middot_groups;
  src.forEach((g, i) => {
    const l = live(g.finding_ids);
    if (l.length) groups.push({ label: `${phase}-${i + 1}:${g.files[0].split("/").pop()}`, files: g.files.map((f) => "jarvis-app/" + f), finding_ids: l });
  });
} else {
  console.error("usage: node build-args.mjs css|all-code|code|middots");
  process.exit(1);
}

console.log(JSON.stringify({ phase, sequential, groups }));
console.error(`${phase}: ${groups.length} groups, ${groups.reduce((n, g) => n + g.finding_ids.length, 0)} findings`);
