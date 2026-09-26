import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axisTicks, chartX } from "./InsightsPage";
import { allRecords } from "./records";

const src = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

// THE LAST FOUR ITEMS OFF THE 2026-09-16 HEALTH POLISH HANDOFF.

// 1. "Check for clipped chart labels." They were: every label was anchored
//    middle, and the first and last points sit at x = PAD and x = CW - PAD, so
//    half a date hung past each edge of the viewBox and the SVG clipped it.
//    And with eight or more sessions the points are closer together than a
//    date is wide, so the middle was a grey smear.
//
// 1b. "Use real temporal spacing and preserve multiple points with identical
//    dates; do not misrepresent repeated Aug 24 entries as separate evenly
//    spaced dates." The chart spaced by INDEX, so a lift trained twice in one
//    morning and then not again for six weeks drew three evenly spaced dots
//    and read as steady fortnightly progress.
const ev = (n: number) => Array.from({ length: n }, (_, i) => 24 + i * 25);

describe("the strength chart's x axis is the calendar", () => {
  it("spaces by the day, not by the count", () => {
    // Three sessions: Sep 1, Sep 3, Sep 29. The middle one belongs near the
    // left, not at the halfway mark an index would put it at.
    const xs = chartX(["2026-09-01", "2026-09-03", "2026-09-29"]);
    expect(xs[0]).toBeCloseTo(12, 5);
    expect(xs[2]).toBeCloseTo(288, 5);
    expect(xs[1]! - xs[0]!, "two days of a 28-day span").toBeCloseTo((276 * 2) / 28, 5);
    expect(xs[1]!, "an index chart would have put it at 150").toBeLessThan(45);
  });

  it("puts two sessions on one date at one x, rather than inventing a gap", () => {
    const xs = chartX(["2026-08-24", "2026-08-24", "2026-09-21"]);
    expect(xs[0]).toBe(xs[1]);
    expect(xs[2]).toBeCloseTo(288, 5);
  });

  it("and a whole series on one date sits together instead of dividing by zero", () => {
    const xs = chartX(["2026-08-24", "2026-08-24", "2026-08-24"]);
    expect(new Set(xs).size).toBe(1);
    expect(xs.every((x) => Number.isFinite(x))).toBe(true);
    expect(xs[0]).toBeCloseTo(150, 5);
  });
});

describe("the strength chart's date labels", () => {
  it("draws every label when there is room for every label", () => {
    // Four points 92 units apart; a date is about 46.
    expect(axisTicks([12, 104, 196, 288])).toEqual([0, 1, 2, 3]);
  });

  it("drops the ones that would overlap, and never the last session", () => {
    const xs = ev(12);
    const t = axisTicks(xs);
    expect(t.at(-1), "the most recent session always has its date").toBe(11);
    for (let i = 1; i < t.length; i++) {
      expect(xs[t[i]!]! - xs[t[i - 1]!]!, `${t[i - 1]} and ${t[i]} overlap`).toBeGreaterThanOrEqual(46);
    }
  });

  it("draws one label for a pile of points sharing an x", () => {
    // Same-date points land on the same x, and a date printed three times on
    // top of itself is the smear this whole rule exists to stop. Which of the
    // tied points carries it does not matter -- they are the same day.
    const xs = [12, 12, 12, 288];
    const t = axisTicks(xs);
    expect(t.length).toBe(2);
    expect(new Set(t.map((i) => xs[i]!))).toEqual(new Set([12, 288]));
    expect(t.at(-1)).toBe(3);
  });

  it("holds for any count, which is what a library of real lifts produces", () => {
    for (const n of [2, 3, 5, 7, 9, 20, 53]) {
      for (const step of [8, 17, 40, 120]) {
        const xs = Array.from({ length: n }, (_, i) => 12 + i * step);
        const t = axisTicks(xs);
        expect(t.at(-1)).toBe(n - 1);
        expect(new Set(t).size, "no repeats").toBe(t.length);
        expect([...t].sort((a, b) => a - b), "in order").toEqual(t);
      }
    }
    expect(axisTicks([50])).toEqual([0]);
    expect(axisTicks([])).toEqual([]);
  });

  it("and the two end labels anchor to their own edge rather than hanging off it", () => {
    const page = src("insights", "InsightsPage.tsx");
    expect(page).toMatch(/textAnchor=\{p\.x <= PAD \+ 1 \? "start" : p\.x >= CW - PAD - 1 \? "end" : "middle"\}/);
  });
});

// 2. "All Data: expandable set tables." A lift's record put every set on the
//    row joined by commas, so five sets of a pyramid wrapped three grey lines
//    in a list whose whole job is scanning.
describe("All Data's set tables", () => {
  const w = {
    id: "w1",
    data: {
      programId: "p", dayId: "d", dayName: "Push", date: "2026-09-16",
      startedAt: 0, endedAt: 60 * 60_000,
      exercises: [{
        exerciseId: "e1", name: "Bench Press", kind: "weight_reps" as const, unit: "lb",
        sets: [
          { id: "a", w: 185, r: 5 },
          { id: "b", w: 205, r: 3 },
          { id: "c", w: 135, r: 10, warmup: true },
        ],
      }],
    },
  };
  const rows = allRecords({ workouts: [w], metricDefs: [], metricLogs: [], lightsOut: [], tookIt: [], medDefs: [], callIt: [], pointAtIt: [], meals: [], checkins: [] });
  const sets = rows.find((r) => r.category === "sets")!;

  // AMENDED 2026-09-16, same day: the table first dropped warm-ups entirely,
  // and the handoff's own line for this item is "Preserve warm-up vs
  // working-set distinction when present". The COUNT is still the working
  // sets, because a ramp counts toward nothing (D3-A) -- but a session where
  // the athlete ramped four times before the first work set is not the same
  // session as one where they did not, and this table is the record of what
  // happened.
  it("numbers the working sets, then names the ramp after them", () => {
    expect(sets.sets).toEqual([
      { label: "Set 1", text: "185 lb × 5" },
      { label: "Set 2", text: "205 lb × 3" },
      { label: "Warm-Up", text: "135 lb × 10", warm: true },
    ]);
  });

  it("and the count above the table is still the work alone", () => {
    expect(sets.value).toBe("2 sets");
  });

  it("a ramp never takes a set number, which would make Set 1 a warm-up", () => {
    for (const row of sets.sets!) {
      if (row.warm) expect(row.label).not.toMatch(/^Set /);
    }
  });

  it("keeps the listing on detail so search still finds a weight inside a closed table", () => {
    expect(sets.detail).toContain("205 lb × 3");
  });

  it("and the page draws the table instead of that string", () => {
    const page = src("insights", "AllDataPage.tsx");
    // AMENDED 2026-09-26 (§AM): the row's one grey is built by quietLine,
    // which folds "imported" into the detail; the suppression is the same.
    expect(page, "the sentence is suppressed where a table exists").toMatch(/const detail = r\.detail && !r\.sets \? r\.detail : null;/);
    expect(page, "and the table is a disclosure").toMatch(/<details className="exp-more ad-sets"/);
  });
});

// 3. "Library count neutral, not red." .nav-action wears --tint because a bar
//    action is something you press; a badge saying how many rows are below it
//    is a status, and LAW L1 says red is a verb and never that.
// 4. "Drop the repeated Weight x Reps from the add-from-your-lifts list."
describe("the last two", () => {
  it("the exercise count is a quiet badge", () => {
    expect(src("gym", "LibraryPage.tsx")).toMatch(/<span className="nav-action nav-count">\{rows\.length\}<\/span>/);
    const rule = /\.nav-action\.nav-count \{[^{}]*\}/.exec(src("styles", "components.css"))?.[0] ?? "";
    expect(rule, "the rule must exist").toBeTruthy();
    expect(rule).toMatch(/color:\s*var\(--tx-3\)/);
  });

  it("the picker names a measurement only when it is news", () => {
    const sheet = src("gym", "LibraryPickSheet.tsx");
    expect(sheet).toMatch(/!kindFilter && entry\.kind !== "weight_reps" &&/);
  });
});

// ---------------------------------------------------------------------------
// FOUND PROOFING THE PASS, 2026-09-16. Four more lines of the handoff that the
// first sweep read as done and were not, plus one thing that was simply wrong.
// ---------------------------------------------------------------------------
describe("the proofing pass", () => {
  it("says the period once, and only the card with a different scope labels its own", () => {
    const page = src("insights", "InsightsPage.tsx");
    // The chips at the top of the page are the heading.
    expect(page.match(/\{rangeLabel\}/g)?.length, "one printing, in the chips").toBe(1);
    expect(page, "and the all-history card says so on its face").toContain("All History");
  });

  // "Remove isolated grey pill buttons: ... View Sets, View Sleep Logs".
  // Every one of that family became a .see-all in September except this one.
  it("no navigation-only capsule is left in the View family", () => {
    for (const f of [["gym", "LiftDetailScreen.tsx"], ["insights", "InsightsPage.tsx"], ["brain", "HealthBody.tsx"]]) {
      const t = src(...f);
      expect(t, `${f[1]} still has a View pill`).not.toMatch(/className="pill-act[^"]*"[^>]*>View /);
    }
    expect(src("gym", "LiftDetailScreen.tsx")).toMatch(/className="see-all"[^>]*>View Logs</);
  });

  // "Weight plus unit share a row; no redundant 'lb' under label."
  it("the exercise sheet says the unit once", () => {
    const sheet = src("gym", "ExerciseSheet.tsx");
    expect(sheet, "no unit printed under the Weight label")
      .not.toMatch(/\(f\.key === "w" \|\| f\.key === "v"\) && unit &&/);
    expect(sheet, "the row that owns the unit keeps it").toMatch(/<div className="conn-name">Unit<\/div>/);
  });

  // NOT FROM THE HANDOFF: the Up Next card read recent[0], the newest workout
  // of ANY day, so Push Day 1 could say "last trained three days ago" about a
  // Leg Day. lastWorkoutForDay has answered this correctly since GYM-F-11.
  it("Up Next's last-trained is this day's own last session", () => {
    const flow = src("gym", "GymFlow.tsx");
    expect(flow).toMatch(/const lastNextDay = nextDay \? lastWorkoutForDay\(nextDay\.id\) : null;/);
    expect(flow, "and the card reads that, not recent[0]").not.toMatch(/recent\[0\] \? `Last trained/);
  });
});
