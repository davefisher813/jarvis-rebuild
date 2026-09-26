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
  // Some plan entries name two files in one string ("a.tsx + src/b.ts"); split
  // them so the no-shared-file merge sees both.
  const norm = (fs) => fs.flatMap((f) => f.split(/\s*\+\s*/)).map((f) => f.replace(/^jarvis-app\//, "")).filter(Boolean);
  const src = [...plan.code_groups, ...plan.middot_groups].map((g) => ({ files: new Set(norm(g.files)), ids: [...g.finding_ids] }));
  const merged = [];
  for (const g of src) {
    const hits = merged.filter((m) => [...g.files].some((f) => m.files.has(f)));
    const into = { files: new Set(g.files), ids: [...g.ids] };
    for (const h of hits) { h.files.forEach((f) => into.files.add(f)); into.ids.push(...h.ids); merged.splice(merged.indexOf(h), 1); }
    merged.push(into);
  }
  // The machine runs two agents per workflow at a time, so many tiny groups
  // spend most of their time on setup. Groups of one area (src/<area>/) are
  // packed together up to CAP findings; they stay file-disjoint because the
  // merged groups already were. A group bigger than CAP on its own is split
  // into batches that share files; with sequential on, batches of one file
  // run in turn (the workflow chains by first file), different files in
  // parallel.
  //   node build-args.mjs all-code [half]   half = 1 | 2 splits areas in two
  //   for two workflows run side by side (disjoint files).
  sequential = true;
  const CAP = 14;
  const area = (f) => f.split("/").slice(0, 2).join("/");
  const packs = [];
  for (const g of merged) {
    const l = live(g.ids);
    if (!l.length) continue;
    const files = [...g.files].sort();
    const n = l.length > CAP ? Math.ceil(l.length / 12) : 1;
    if (n > 1) {
      for (let k = 0; k < n; k++) packs.push({ area: area(files[0]), files, ids: l.slice(Math.floor((k * l.length) / n), Math.floor(((k + 1) * l.length) / n)), part: k + 1, solo: true });
      continue;
    }
    const open = packs.find((p) => !p.solo && p.area === area(files[0]) && p.ids.length + l.length <= CAP);
    if (open) { open.files.push(...files); open.ids.push(...l); }
    else packs.push({ area: area(files[0]), files: [...files], ids: [...l] });
  }
  const areas = [...new Set(packs.map((p) => p.area))].sort();
  const half = Number(process.argv[3] || 0);
  // Balance the two halves by finding count, whole areas at a time.
  const load = Object.fromEntries(areas.map((a) => [a, packs.filter((p) => p.area === a).reduce((n, p) => n + p.ids.length, 0)]));
  const sideA = new Set(); let na = 0, nb = 0;
  for (const a of [...areas].sort((x, y) => load[y] - load[x])) { if (na <= nb) { sideA.add(a); na += load[a]; } else nb += load[a]; }
  packs.forEach((p, i) => {
    if (half === 1 && !sideA.has(p.area)) return;
    if (half === 2 && sideA.has(p.area)) return;
    const label = `code-${i + 1}:${p.area.replace(/^src\//, "")}:${p.files[0].split("/").pop()}` + (p.part ? `#${p.part}` : "");
    groups.push({ label, files: p.files.map((f) => "jarvis-app/" + f), finding_ids: p.ids });
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
