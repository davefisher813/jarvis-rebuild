// Runs in every test file (vitest.config.ts setupFiles). In a jsdom test it
// watches what the screen draws and checks it against the visual catalog the
// moment it is drawn (laws/catalogCheck.ts). A violation fails the test that
// drew it, unless the file is on the roster in catalogRoster.ts with a reason.
// CATALOG_REPORT=<file> appends the violations to that file instead of failing,
// which is how the roster was first measured (with only the certain homes, so a
// capsule's ancestor chain shows what else it sits in).
import { afterEach, beforeEach } from "vitest";
import { appendFileSync } from "node:fs";
import { capsuleSites, loneActionBoxes, numberCaseViolations } from "./catalogCheck";
import { CAPSULE_ROSTER, LONE_ACTION_ROSTER, NUMBER_CASE_ROSTER } from "./catalogRoster";

let seen: Set<string> | null = null;
let obs: MutationObserver | null = null;

function scan(nodes: Node[]) {
  for (const n of nodes) {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    if (!el || !el.isConnected) continue;
    for (const v of numberCaseViolations(el)) seen?.add("NUMBER\t" + v);
    // The report measures with only the certain homes, so the ancestor chain shows what else a capsule sits in.
    for (const v of capsuleSites(el, process.env.CATALOG_REPORT ? ".sh2, .action-sheet, .toast, .toast-dock" : undefined))
      seen?.add(`CAPSULE\t${v.label} @ ${v.where === "foot" ? "foot of " : ""}${v.box}\t${v.chain}`);
    for (const v of loneActionBoxes(el.closest(".card, .list-card-ruled, .empty-state") ?? el)) seen?.add("BOX\t" + v);
  }
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  beforeEach(() => {
    seen = new Set();
    obs = new MutationObserver((records) => {
      const nodes: Node[] = [];
      for (const r of records) {
        if (r.type === "characterData") nodes.push(r.target);
        else nodes.push(...Array.from(r.addedNodes));
      }
      scan(nodes);
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  afterEach((ctx) => {
    if (!obs) return;
    scan(
      obs.takeRecords().flatMap((r) => (r.type === "characterData" ? [r.target] : Array.from(r.addedNodes))),
    );
    obs.disconnect();
    obs = null;
    const found = [...(seen ?? [])];
    seen = null;
    if (!found.length) return;
    const file = (ctx.task.file?.filepath ?? "").replace(/^.*\/src\//, "");
    const report = process.env.CATALOG_REPORT;
    if (report) {
      appendFileSync(report, found.map((v) => `${file}\t${v}`).join("\n") + "\n");
      return;
    }
    const num = found.filter((v) => v.startsWith("NUMBER\t") && !NUMBER_CASE_ROSTER[file]).map((v) => v.slice(7));
    const box = found.filter((v) => v.startsWith("BOX\t") && !LONE_ACTION_ROSTER[file]).map((v) => v.slice(4));
    // "label @ row-class" is the finding; what follows its tab is the ancestor chain, for the report only.
    const caps = found
      .filter((v) => v.startsWith("CAPSULE\t"))
      .map((v) => v.split("\t")[1]!)
      .filter((v, i, all) => all.indexOf(v) === i && !(v in (CAPSULE_ROSTER[file] ?? {})));
    if (num.length)
      throw new Error(`Catalog: a lowercase word follows a leading number (the word after a leading number takes a capital) · Drawn: ${num.join(" | ")}`);
    if (caps.length)
      throw new Error(
        `Catalog: a capsule sits in a list row or at the foot of a list card (Dave 2026-10-05, no pills in a row: the verb is the swipe, the sheet and the long press, and a section's action is its head's capsule) · Drawn: ${caps.join(" | ")}`,
      );
    if (box.length)
      throw new Error(`Catalog: a card holds nothing but an action, so the capsule stands by itself with no box · Drawn: ${box.join(" | ")}`);
  });
}
