// LAW: A CONTROL SAYS WHAT IT DOES, AND WHICH ONE IT WOULD DO IT TO.
//
// The button audit of 2026-09-19 read LABELS out of the source and reported
// 208 nameless controls. Every one was false: the label was conditional, or
// interpolated, or looked up from a map the scanner could not follow. The
// only honest version of this question is asked of the RENDERED page, so it
// lives in tools/visual-audit.mjs as the `no-name` check, measured against
// the accessibility tree across 22 screens and their sheets.
//
// It found zero, and that result was itself verified rather than believed: a
// nameless icon button injected into the page is caught, and nothing else
// is. The app genuinely has no unnamed controls.
//
// What it cannot ask is the second half, which this file holds instead.
// "Delete" is a name. On a list it is not an ANSWER: on the web build a
// swipe rail's buttons are siblings of the row, so a screen reader reaching
// one hears "Delete" with nothing saying which record. This app already
// knew that -- twelve destructive controls pass the record's name and five
// did not, which is the same drift every other sweep this week found.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
const AUDITOR = readFileSync(join(SRC, "../tools/visual-audit.mjs"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

// A bare label on a destructive control, i.e. one with no record in it.
// These are string literals; anything interpolated names something.
const BARE = /aria-label="(Delete|Remove|Archive|Later|Delete task|Delete note|Remove item|Remove link|Delete forever)"/;

// Where a bare verb is the whole answer, because there is only one record on
// the screen to apply it to.
const SINGLE_RECORD: Record<string, string> = {
  "messages/MessagesFlow.tsx": "the thread DETAIL view's nav bar: one thread on screen, so the verb is unambiguous",
  "notes/screens/Connections.tsx": "Remove link, inside the one connection's own row",
  "tasks/screens/TaskSheet.tsx": "Remove item, inside the one checklist item's row",
};

describe("LAW: every control has a name, and a rail action names its record", () => {
  it("the auditor asks the rendered page, not the source", () => {
    // The static version of this question produced 208 false findings. If the
    // runtime check is ever removed, the temptation is to bring it back.
    expect(AUDITOR, "the accessible-name check").toMatch(/no-name/);
    expect(AUDITOR, "computed from the tree, including aria-labelledby").toMatch(/aria-labelledby/);
  });

  it("a destructive control in a LIST names the record it would destroy", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = relative(SRC, f).replace(/\\/g, "/");
      if (/^(bench|testpanel|laws)\//.test(r)) continue;
      if (r in SINGLE_RECORD) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) return;
        if (BARE.test(line)) offenders.push(`${r}:${i + 1}`);
      });
    }
    expect(offenders, 'a bare "Delete" on a row: pass the record name, or add the file to SINGLE_RECORD with its reason')
      .toEqual([]);
  });

  it("the single-record exemptions still exist", () => {
    for (const f of Object.keys(SINGLE_RECORD)) {
      expect(() => readFileSync(join(SRC, f), "utf8"), f).not.toThrow();
    }
  });
});
