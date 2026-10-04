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
      for (const m of src.matchAll(/className="([^"]*\btask-snooze\b[^"]*)"([\s\S]{0,200}?)aria-label="([^"]+)"/g)) {
        seen++;
        const classes = m[1]!.split(/\s+/);
        if (classes.includes("task-snooze-solo") || classes.includes("note-append")) continue;
        if (!(SECOND_SLOT[rel] ?? []).includes(m[3]!)) bad.push(`${rel}: "${m[3]}" is a bare .task-snooze outside the second-slot roster`);
      }
    }
    expect(seen, "the scan found the buttons it is about").toBeGreaterThanOrEqual(5);
    expect(bad, "a one-action reveal needs task-snooze-solo, or add it to the roster with the Delete it sits beside").toEqual([]);
  });

  it("the Notifications nudge and the Momentum row use the outer slot", () => {
    const nudge = readFileSync(join(SRC, "notifications/NotificationsFlow.tsx"), "utf8");
    const momentum = readFileSync(join(SRC, "tasks/screens/TasksPage.tsx"), "utf8");
    expect(nudge).toMatch(/className="task-snooze task-snooze-solo"[^]*?aria-label="Dismiss"/);
    expect(momentum).toMatch(/className="task-snooze task-snooze-solo"[^]*?aria-label="Not now"/);
  });

  it("the stylesheet moves task-snooze-solo to right:0, and the bare slot stays at 88", () => {
    const css = readFileSync(join(SRC, "styles/components.css"), "utf8");
    expect(css).toMatch(/\.task-snooze\.task-snooze-solo\s*\{\s*right:\s*0;\s*\}/);
    expect(css).toMatch(/\.task-snooze\s*\{[^}]*right:\s*88px/);
  });
});
