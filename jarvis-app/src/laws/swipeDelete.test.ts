// LAW (Dave, 2026-09-20, off a screenshot of a schedule row's rail):
// "Should be able to delete always."
//
// Every swipeable row in this app stands for a record: a task, a note, a mail
// thread, an event, a reminder, a bill, a set. The swipe is where a row's
// secondary actions live, and the audit that produced this law found Delete on
// four of them and missing from four others, for no reason anyone had written
// down. It was not a policy, it was drift: each row was built on the day its
// screen was built and nobody compared them afterwards. A reminder could be
// ticked from the row and removed only from inside its sheet; a bill the same;
// a schedule row spent its whole rail on time nudges.
//
// So the rule is the comparison this app kept failing to make: a row that
// carries the swipe controller either offers a way to get rid of the thing, or
// appears below with a reason it cannot.
//
// The scan is deliberately structural rather than clever. It finds every
// useSwipe() call, names the component it sits in, and reads the render body
// that follows it for a delete affordance. A character-matching law can only
// ever be as good as its roster, so the roster is explicit and an unknown
// component fails loudly rather than passing quietly.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

// The classes that ARE a delete on a swipe rail. Each is the real one used by
// a shipping row, not a guess: .task-del is the shared red panel on Tasks,
// Notes, Mail, the gym set and now Bills and Reminders; .notice-delete is the
// Today notice's; .sched-act-danger is the schedule rail's, added the same day
// as this law.
const DELETE_CLASSES = ["task-del", "notice-delete", "sched-act-danger"];

// A row whose record cannot be deleted from the rail, and why. Every entry is
// a decision someone made on purpose; none of them is "we did not get to it".
const EXEMPT: Record<string, string> = {
  // A nudge is DERIVED from a task or an event and owns no record of its own.
  // Delete here would have to delete the thing being reported on, which is not
  // what a notification screen is for, and the row already opens that thing.
  // Dismiss is the honest verb and this row has it, plus a long-press sheet.
  NudgeRow: "a nudge is a view of a task or event, not a record; Dismiss is its exit",
  // The file says it: "a suggestion is deferred, never deleted". Not Now is
  // the whole vocabulary this row is allowed.
  MomentumRow: "a suggestion is deferred, never deleted (Not Now is the verb)",
  // Let Go IS the delete for a thread you are waiting on: it stops the app
  // tracking it. A second destructive verb beside it would be two names for
  // one act. The mail row proper (MailSwipe) carries a real Delete.
  LetGoSwipe: "Let Go is this row's delete: it stops the waiting-on tracking",
  // The headliner is the move currently being made, not a record. Stop ends
  // the move; the task it is about is deletable on every list that shows it.
  MoveHeadliner: "a move in progress, not a record; Stop ends it",
  // NoticeCard is NOT here: it renders .notice-delete when its producer passes
  // onDelete, so it satisfies the law on its own terms. Its guaranteed exit is
  // Dismiss either way, held by its own law in laws.test.ts.
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** The nearest `function Name(` above an index: the component that swipes. */
function ownerOf(src: string, at: number): string {
  const before = src.slice(0, at);
  const hits = [...before.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)];
  return hits.length ? hits[hits.length - 1]![1]! : "?";
}

/** The render body after the hook, to the next top-level function or EOF. */
function bodyAfter(src: string, at: number): string {
  const rest = src.slice(at);
  const end = rest.search(/\n(export\s+)?(default\s+)?function\s/);
  return end === -1 ? rest : rest.slice(0, end);
}

type Row = { file: string; owner: string; body: string };

function swipeRows(): Row[] {
  const rows: Row[] = [];
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f).replace(/\\/g, "/");
    if (rel === "shared/useSwipe.ts" || rel.startsWith("bench/") || rel.startsWith("laws/")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/useSwipe\(/g)) {
      const at = m.index!;
      rows.push({ file: rel, owner: ownerOf(src, at), body: bodyAfter(src, at) });
    }
  }
  return rows;
}

describe("LAW: a swipeable row can be deleted, or says why not", () => {
  it("finds the swipe rows at all", () => {
    // If this ever drops toward zero the law above has gone blind and every
    // other expectation in this file passes for the wrong reason.
    const rows = swipeRows();
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it("every swipeable row offers Delete, or is exempt with a reason", () => {
    const missing = swipeRows()
      .filter((r) => !DELETE_CLASSES.some((c) => r.body.includes(c)))
      .filter((r) => !(r.owner in EXEMPT))
      .map((r) => `${r.file} :: ${r.owner}`);
    expect(
      missing,
      "add Delete to the rail, or add the component to EXEMPT with the reason it cannot have one",
    ).toEqual([]);
  });

  it("no exemption is claimed by a row that has since grown a Delete", () => {
    // The roster rots in the other direction too: an exemption left behind
    // after the row gained a Delete reads as policy and is a lie.
    const stale = swipeRows()
      .filter((r) => r.owner in EXEMPT)
      .filter((r) => DELETE_CLASSES.some((c) => r.body.includes(c)))
      .map((r) => `${r.file} :: ${r.owner}`);
    expect(stale, "these rows have a Delete; drop their EXEMPT entry").toEqual([]);
  });

  it("every exemption names a component that still exists", () => {
    const owners = new Set(swipeRows().map((r) => r.owner));
    const gone = Object.keys(EXEMPT).filter((k) => !owners.has(k));
    expect(gone, "these exemptions point at components that no longer swipe").toEqual([]);
  });
});

describe("LAW: a schedule rail is as wide as the buttons in it", () => {
  // The bug this law exists for: .sched-act is a fixed width and .sched-strip
  // clips, so a hard-coded revealW that disagrees with the button count paints
  // buttons outside the reveal where no finger can reach them. -15m lived
  // there for weeks. Both rows count their actions now, and the constant they
  // multiply has to keep matching the stylesheet.
  const rail = readFileSync(join(SRC, "schedule/screens/schedRail.ts"), "utf8");
  const css = readFileSync(join(SRC, "styles/components.css"), "utf8");

  it("SCHED_ACT_W is the width the stylesheet actually paints", () => {
    const declared = Number((rail.match(/SCHED_ACT_W\s*=\s*(\d+)/) ?? [])[1]);
    const painted = Number((css.match(/\.sched-act\s*\{[^}]*?width:\s*(\d+)px/) ?? [])[1]);
    expect(declared, "SCHED_ACT_W must be a number").toBeGreaterThan(0);
    expect(painted, ".sched-act must declare a px width").toBe(declared);
  });

  it("neither schedule row hard-codes a reveal width again", () => {
    for (const f of ["schedule/screens/DayRow.tsx", "schedule/screens/LockedRow.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      const call = (src.match(/useSwipe\(\{[^}]*\}/) ?? [])[0] ?? "";
      expect(call, `${f}: revealW must be counted, not a literal`).toMatch(/revealW:\s*acts\s*\*\s*SCHED_ACT_W/);
    }
  });

  it("no rail renders more actions than fit a phone row", () => {
    // Three 88s is 264 of a 358px row. A fourth hides the event behind the
    // buttons acting on it, which is how a rail stops being readable.
    //
    // Counted off the `acts` array rather than the JSX, on purpose: the JSX
    // holds BOTH arms of the repeating ternary (Skip Today and Tomorrow) and
    // only ever paints one, so reading the markup says four where three
    // render. The array is one entry per rail slot, which is the real ceiling
    // and is also the number the reveal width is computed from, so this law
    // and the geometry cannot disagree.
    const max = Number((rail.match(/SCHED_ACT_MAX\s*=\s*(\d+)/) ?? [])[1]);
    expect(max, "SCHED_ACT_MAX must be a number").toBeGreaterThan(0);
    for (const f of ["schedule/screens/DayRow.tsx", "schedule/screens/LockedRow.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      const arr = (src.match(/const acts = \[([^\]]*)\]/) ?? [])[1];
      expect(arr, `${f}: no counted acts array`).toBeTruthy();
      const slots = arr!.split(",").filter((x) => x.trim()).length;
      expect(slots, `${f}: ${slots} rail slots, the ceiling is ${max}`).toBeLessThanOrEqual(max);
    }
  });
});
