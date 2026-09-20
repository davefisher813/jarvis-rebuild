// LAW L7, WHICH THIS CATALOG HAS STATED THREE TIMES AND NEVER ENFORCED.
//
//   "No screen dead-ends: an empty state always carries its action."   (§7)
//   "When an action exists, the button is IN the empty state. An empty state
//    that tells the user where to go instead of taking them there fails the
//    gate."                                                           (§132)
//   "NO DEAD-END SURFACES (the ADHD rule, Dave 2026-08-19: 'the more I can do
//    and feel like I didn't have to think, the better')."             (§203)
//
// Written down, quoted in commit messages, and never once checked. The states
// sweep of 2026-09-20 found 26 of 65 empty states with nothing to tap, and
// two of those were not empty states at all: they were LOADS, wearing the
// costume, with the literal word "Loading..." as their title, four lines
// under a comment citing this very law.
//
// So it is a test now. The roster below is exhaustive and exact: a new dead
// end fails, and FIXING one also fails, because a list that can only grow is
// how the debt stopped being visible the first time.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Every `.empty-state` block in the app, with whether it holds a control. */
function emptyStates(): { at: string; hasAction: boolean }[] {
  const out: { at: string; hasAction: boolean }[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    const src = readFileSync(f, "utf8");
    let i = 0;
    for (;;) {
      const at = src.indexOf('className="empty-state', i);
      if (at === -1) break;
      i = at + 10;
      // A generous slice, cut at the next empty-state so two never merge.
      const slice = src.slice(at, at + 1400);
      const nxt = slice.indexOf('className="empty-state', 10);
      const block = nxt === -1 ? slice : slice.slice(0, nxt);
      // KEYED BY ITS TITLE, NOT ITS LINE. The first version used file:line,
      // and the very next edit in the same commit -- a comment added above one
      // of these blocks -- shifted two entries and turned the law red for a
      // reason that had nothing to do with dead ends. A roster nobody can edit
      // without breaking it gets deleted, not maintained.
      // A title that is an EXPRESSION is not a name. {title} and a ternary
      // both read back as their own source, which is not a key anyone could
      // look up; those fall through to the ordinal instead.
      const title = (block.match(/empty-title[^>]*>([^<{][^<{}]{2,47})/) ?? [])[1]?.trim();
      const n = out.filter((e) => e.at.startsWith(r + " \u00b7 ")).length;
      out.push({
        at: `${r} \u00b7 ${title || "#" + (n + 1)}`,
        hasAction: /<button|role="button"|row-act|btn-primary|btn-secondary|onClick=/.test(block),
      });
    }
  }
  return out;
}

// Dead ends that are CORRECT. Each is read and reasoned, not waved through.
const NO_ACTION_EXISTS: Record<string, string> = {
  "admin/AdminPanel.tsx · Not Authorized": "the only move is to be someone else",
  "admin/AdminPanel.tsx · Metrics Are Not Loaded": "a fetch that did not run; the panel reloads from its own bar",
  "admin/AdminPanel.tsx · Feedback Is Not Loaded": "same, for feedback",
  "admin/AdminPanel.tsx · Nothing Sent Yet": "nobody has written in; there is nothing to do about that",
  "gym/DuplicateReview.tsx · Nothing Left to Review": "the queue is finished, which is the good outcome",
  "health/screens/TwoDaysOffScreen.tsx · Already Two Days Off": "a status about the past, not a thing to act on",
  "review/InsightsFlow.tsx · The First Crossing Starts It": "waiting on an achievement, which cannot be tapped into being",
  "review/ReportPage.tsx · No Month Sealed Yet": "the report arrives on the 1st on its own",
  "search/SearchFlow.tsx · Search Everything": "the search idle state; the field above it IS the action and has focus",
  "brain/strands/StrandsPage.tsx · Nothing Under This One": "a filter with no members; the chips that change it are on screen",
};

// The action is already ON THE SCREEN, just not inside the box. The catalog
// rejects a SECOND door in the same words it demands the first one
// ("a second door is bad; a second door with a false sign on it is worse"),
// so duplicating these would trade one finding for a worse one.
const ACTION_ON_SCREEN: Record<string, string> = {
  "connections/ConnectionsPage.tsx · Google Setup Required": "Connect Google sits three rows below, on this screen",
  "connections/ConnectionsPage.tsx · No Accounts Yet": "same button, same screen",
  "schedule/screens/SchedulePage.tsx · Nothing Repeats Yet": "its own comment: the bar keeps the job, and this door once carried a false sign",
  "brain/strands/StrandsPage.tsx · Nothing Noticed Yet": "Add One Thing is on this screen, below the list",
  "schedule/screens/PlanDaySheet.tsx · #1": "the sheet's own add field is below it, and the sub says so only when it exists",
};

// REAL DEBT. The action exists but lives on ANOTHER screen, so these fail L7
// as written: they tell him where to go instead of taking him. Each needs a
// callback plumbed from its parent, which is a change to make deliberately
// and not in a sweep. Listed so the number can only go down.
const ACTION_ELSEWHERE: Record<string, string> = {
  "life/tabs/AreasTab.tsx · #1": "says 'Add one in Settings > Categories' in words; needs an onOpenCategories prop",
  "gym/LiftDetailScreen.tsx · No Numbers Yet": "needs the log-a-set door for this exercise",
  "insights/InsightsPage.tsx · No Sets Logged Yet": "needs the same door as the lift detail screen",
  "health/screens/WhatTheySeeScreen.tsx · Nothing Shared Yet": "needs the share-a-category toggle, which lives in health settings",
  "health/screens/NightBeforeScreen.tsx · Nothing Fixed Tomorrow Yet": "needs tomorrow's start time, which is set on Schedule",
  "insights/AllDataPage.tsx · #1": "nothing is recorded yet; the doors are the loggers on other screens",
  "health/HealthFlow.tsx · #1": "a shared empty component: its callers pass the copy, so the action is theirs",
};

describe("LAW L7: an empty state carries its action", () => {
  const states = emptyStates();

  it("finds the empty states at all", () => {
    expect(states.length).toBeGreaterThanOrEqual(50);
  });

  it("every dead end is one of the three rosters, and every roster entry is a dead end", () => {
    const dead = states.filter((s) => !s.hasAction).map((s) => s.at).sort();
    const listed = [
      ...Object.keys(NO_ACTION_EXISTS),
      ...Object.keys(ACTION_ON_SCREEN),
      ...Object.keys(ACTION_ELSEWHERE),
    ].sort();
    // Exact, both ways. A new dead end fails; fixing one fails too, so the
    // roster has to be edited down rather than quietly outgrown.
    expect(dead, "a new empty state with nothing to tap, or a roster entry that moved").toEqual(listed);
  });

  it("the debt list only shrinks", () => {
    // The number that matters. It was 7 when this law was written.
    expect(Object.keys(ACTION_ELSEWHERE).length,
      "an empty state that points at another screen instead of taking him there").toBeLessThanOrEqual(7);
  });

  it("no empty state is really a load in disguise", () => {
    // Two of these shipped: an .empty-state whose title was "Loading...",
    // which tells him there is nothing here on a screen that does not know
    // yet. SkeletonRows exists for this and sixteen other lists use it.
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = relative(SRC, f).replace(/\\/g, "/");
      if (/^(bench|testpanel|laws)\//.test(r)) continue;
      const src = readFileSync(f, "utf8");
      let i = 0;
      for (;;) {
        const at = src.indexOf('className="empty-state', i);
        if (at === -1) break;
        i = at + 10;
        const block = src.slice(at, at + 400);
        if (/loading|fetching|please wait/i.test(block)) {
          offenders.push(`${r}:${src.slice(0, at).split("\n").length}`);
        }
      }
    }
    expect(offenders, "a load is a skeleton, never an empty state").toEqual([]);
  });
});
