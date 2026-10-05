// LAW (2026-10-04, the dead-button sweep): a one-action swipe reveal puts its
// button in the OUTER slot.
//
// A swipe row slides left by the width of its reveal, 88px per action. The
// button at right:0 is the one a one-action reveal uncovers. .task-snooze is
// the SECOND slot (right:88px, beside a Delete at right:0), so a row that
// reveals only a .task-snooze still covers it: the swipe opened onto an empty
// strip and a tap on the amber hit the row. The Notifications nudge's Dismiss
// and the Momentum row's Not Now both shipped that way; messages/LetGoSwipe.tsx
// documents the first time the same bug was found and fixed.
//
// jsdom has no layout, so the geometry cannot be measured here. What can be
// held is the rule that produces it: a bare .task-snooze is only ever drawn
// as a second slot, on the roster below, and every other one says
// task-snooze-solo, which the stylesheet moves to right:0.
//
// AMENDED (Dave 2026-10-05, locked row model: swipe left is the one quick verb, rows are clean). The rows were
// rebuilt: a first verb is `.task-verb` (right:0 by construction), a second is `.task-verb-2` or the solo snooze that
// steps in behind a `.task-verb`, and every Today row rides SwipeShell, whose slots are counted from its action list.
// The scan below also reads `aria-label={...}` buttons now, since the new rows name their verb from data.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

// A bare .task-snooze that really is a second slot: its reveal is 176px or
// more and a Delete sits at right:0 beside it. Keyed by file, then by the
// button's aria-label.
const SECOND_SLOT: Record<string, string[]> = {
  "tasks/screens/TasksPage.tsx": ["Move to tomorrow"],
  "notes/screens/NotesList.tsx": ["File under an area"],
};

describe("a one-action swipe reveal uses the outer slot", () => {
  it("every .task-snooze button is a roster second slot, a note-append, or task-snooze-solo", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/className="([^"]*\btask-snooze\b[^"]*)"([\s\S]{0,200}?)aria-label=(?:"([^"]+)"|\{)/g)) {
        seen++;
        const classes = m[1]!.split(/\s+/);
        if (classes.includes("task-snooze-solo")) continue;
        const name = m[3] ?? "{computed}";
        if (!(SECOND_SLOT[rel] ?? []).includes(name)) bad.push(`${rel}: "${name}" is a bare .task-snooze outside the second-slot roster`);
      }
    }
    // Four today: Tasks (Move to tomorrow, Not now), the Reminders page and the Reminders strip (Snooze). The notes and
    // the Notifications nudge moved to .task-verb and SwipeShell, so the floor is four, not five.
    expect(seen, "the scan found the buttons it is about").toBeGreaterThanOrEqual(4);
    expect(bad, "a one-action reveal needs task-snooze-solo, or add it to the roster with the Delete it sits beside").toEqual([]);
  });

  it("a .task-verb-2 is only ever the second slot, beside a first .task-verb", () => {
    // The mirror of the rule above for the new verb classes: `.task-verb` is right:0, and `.task-verb-2` is right:88px.
    // A file that draws a -2 with no first verb would open its swipe onto an empty strip, the same bug.
    const lone: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      const src = readFileSync(f, "utf8");
      if (!/task-verb-2/.test(src)) continue;
      if (!/"task-verb"/.test(src)) lone.push(rel);
    }
    expect(lone, "a task-verb-2 with no first task-verb").toEqual([]);
  });

  it("the Today row shell and the Momentum row use the outer slot", () => {
    // Notifications, the dealt move, the nudges and the suggestions ride SwipeShell (today/MoveHeadliner.tsx). Its
    // reveal is counted from its actions (88px each) and slot i sits at right: i * 88, so the first verb is the outer
    // one and no slot is ever under the row.
    const shell = readFileSync(join(SRC, "today/MoveHeadliner.tsx"), "utf8");
    const nudge = readFileSync(join(SRC, "notifications/NotificationsFlow.tsx"), "utf8");
    const momentum = readFileSync(join(SRC, "tasks/screens/TasksPage.tsx"), "utf8");
    expect(shell).toMatch(/revealW:\s*actions\.length\s*\*\s*88/);
    expect(shell).toMatch(/className="notice-alt"[^]*?style=\{i \? \{ right: i \* 88 \} : undefined\}/);
    expect(nudge, "Notifications ride the shell").toMatch(/<SwipeShell/);
    expect(momentum).toMatch(/className="task-snooze task-snooze-solo"[^]*?aria-label="Not now"/);
  });

  it("the stylesheet moves task-snooze-solo to right:0, and the bare slot stays at 88", () => {
    const css = readFileSync(join(SRC, "styles/components.css"), "utf8");
    expect(css).toMatch(/\.task-snooze\.task-snooze-solo\s*\{\s*right:\s*0;\s*\}/);
    expect(css).toMatch(/\.task-snooze\s*\{[^}]*right:\s*88px/);
  });
});
