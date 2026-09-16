import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { axisTicks } from "./InsightsPage";
import { allRecords } from "./records";

const src = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

// THE LAST FOUR ITEMS OFF THE 2026-09-16 HEALTH POLISH HANDOFF.

// 1. "Check for clipped chart labels." They were: every label was anchored
//    middle, and the first and last points sit at x = PAD and x = CW - PAD, so
//    half a date hung past each edge of the viewBox and the SVG clipped it.
//    And with eight or more sessions the points are closer together than a
//    date is wide, so the middle was a grey smear.
describe("the strength chart's date axis", () => {
  it("draws every label when there is room for every label", () => {
    // 300 wide, 24 of padding, four points: 92 units apart, a date is ~46.
    expect(axisTicks(4, 92)).toEqual([0, 1, 2, 3]);
  });

  it("drops the ones that would overlap, and never the last session", () => {
    const t = axisTicks(12, 25);
    expect(t.at(-1), "the most recent session always has its date").toBe(11);
    for (let i = 1; i < t.length; i++) {
      expect((t[i]! - t[i - 1]!) * 25, `${t[i - 1]} and ${t[i]} overlap`).toBeGreaterThanOrEqual(46);
    }
  });

  it("holds for any count, which is what a library of real lifts produces", () => {
    for (const n of [2, 3, 5, 7, 9, 20, 53]) {
      for (const step of [8, 17, 40, 120]) {
        const t = axisTicks(n, step);
        expect(t.at(-1)).toBe(n - 1);
        expect(new Set(t).size, "no repeats").toBe(t.length);
        expect([...t].sort((a, b) => a - b), "in order").toEqual(t);
      }
    }
    expect(axisTicks(1, 50)).toEqual([0]);
    expect(axisTicks(0, 50)).toEqual([]);
  });

  it("and the two end labels anchor to their own edge rather than hanging off it", () => {
    const page = src("insights", "InsightsPage.tsx");
    expect(page).toMatch(/textAnchor=\{i === 0 \? "start" : i === pts\.length - 1 \? "end" : "middle"\}/);
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

  it("carries one named line per working set, and no warm-up", () => {
    expect(sets.sets).toEqual([
      { label: "Set 1", text: "185 lb × 5" },
      { label: "Set 2", text: "205 lb × 3" },
    ]);
  });

  it("keeps the listing on detail so search still finds a weight inside a closed table", () => {
    expect(sets.detail).toContain("205 lb × 3");
  });

  it("and the page draws the table instead of that string", () => {
    const page = src("insights", "AllDataPage.tsx");
    expect(page, "the sentence is suppressed where a table exists").toMatch(/\{r\.detail && !r\.sets &&/);
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
