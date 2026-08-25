import { describe, it, expect } from "vitest";
import {
  windowStart, completionsIn, measureState, paceLine, healthOf, idle, seenRate,
  measureLabel, IDLE_DAYS, type MeasureContext, type Measure,
} from "./measure";
import type { GoalReach } from "./reach";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";

const DAY = 86400000;
// Monday 2026-08-24, midday UTC-agnostic (built from a local date string).
const NOW = new Date("2026-08-24T12:00:00").getTime();
const TODAY = "2026-08-24";

function proj(id: string, over: Partial<Project["data"]> = {}): Project {
  return { id, data: { title: id, status: "active", ...over } };
}
function goal(over: Partial<Goal["data"]> = {}): Goal {
  return { id: "g", data: { title: "G", state: "on_track", ...over } };
}
function ctx(over: Partial<MeasureContext> = {}): MeasureContext {
  const reach: GoalReach = { filedIds: [], taggedIds: [], openTagged: 0, progress: null };
  return { reach, tasks: [], projects: [], samples: [], today: TODAY, now: NOW, ...over };
}

describe("windowStart", () => {
  it("runs the week Monday first", () => {
    // NOW is a Monday, so the week starts at its own midnight.
    const wk = windowStart("week", NOW);
    expect(new Date(wk).getDay()).toBe(1);
    expect(NOW - wk).toBeLessThan(DAY);
  });
  it("starts the month on the first", () => {
    expect(new Date(windowStart("month", NOW)).getDate()).toBe(1);
  });
  it("reaches back six days from a Sunday", () => {
    const sun = new Date("2026-08-23T12:00:00").getTime();
    expect(new Date(windowStart("week", sun)).getDay()).toBe(1);
  });
});

describe("completionsIn", () => {
  it("counts only this goal's tasks, only inside the window", () => {
    const c = ctx({
      reach: { filedIds: ["a"], taggedIds: ["b"], openTagged: 0, progress: null },
      samples: [
        { id: "a", t: NOW - DAY },
        { id: "b", t: NOW - 2 * DAY },
        { id: "c", t: NOW - DAY },      // not this goal's
        { id: "a", t: NOW - 40 * DAY }, // outside
      ],
    });
    expect(completionsIn(c, NOW - 7 * DAY)).toBe(2);
  });
  it("never counts a sample from the future", () => {
    const c = ctx({ reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null }, samples: [{ id: "a", t: NOW + DAY }] });
    expect(completionsIn(c, NOW - 7 * DAY)).toBe(0);
  });
});

describe("measureState: cadence", () => {
  const m: Measure = { kind: "cadence", times: 3, per: "week" };
  it("counts what Time Sense saw this week", () => {
    const c = ctx({
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [{ id: "a", t: NOW - 60000 }, { id: "a", t: NOW - 120000 }],
    });
    expect(measureState(m, c)).toMatchObject({ done: 2, target: 3, met: false, line: "2 of 3 This week" });
  });
  it("is met, not overflowed, past the target", () => {
    const c = ctx({
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [1, 2, 3, 4].map(() => ({ id: "a", t: NOW - 60000 })),
    });
    const s = measureState(m, c)!;
    expect(s.met).toBe(true);
    expect(s.pct).toBe(100);
  });
});

describe("measureState: projects", () => {
  it("counts closed projects against every project filed under it", () => {
    const c = ctx({ projects: [proj("p1", { status: "done" }), proj("p2")] });
    expect(measureState({ kind: "projects" }, c)).toMatchObject({ done: 1, target: 2, met: false });
  });
  it("says so rather than dividing by zero", () => {
    expect(measureState({ kind: "projects" }, ctx())!.line).toBe("No projects under it yet");
  });
});

describe("measureState: count", () => {
  it("counts filed completions in full", () => {
    const c = ctx({ reach: { filedIds: ["a", "b"], taggedIds: [], openTagged: 0, progress: { done: 2, total: 2, pct: 100 } } });
    expect(measureState({ kind: "count", target: 12 }, c)).toMatchObject({ done: 2, target: 12, met: false });
  });
  it("NEVER inherits tagged history: without a stamp, tagged work contributes nothing", () => {
    const c = ctx({
      reach: { filedIds: [], taggedIds: ["x", "y"], openTagged: 0, progress: null },
      samples: [{ id: "x", t: NOW - 400 * DAY }, { id: "y", t: NOW - 300 * DAY }],
    });
    expect(measureState({ kind: "count", target: 12 }, c)!.done).toBe(0);
  });
  it("counts tagged completions from the day the measure was set, forward", () => {
    const c = ctx({
      reach: { filedIds: [], taggedIds: ["x", "y"], openTagged: 0, progress: null },
      samples: [{ id: "x", t: NOW - 400 * DAY }, { id: "y", t: NOW - DAY }],
    });
    expect(measureState({ kind: "count", target: 12, since: "2026-08-01" }, c)!.done).toBe(1);
  });
  it("is null with no measure at all", () => {
    expect(measureState(undefined, ctx())).toBeNull();
  });
});

describe("paceLine (pick 14)", () => {
  const m: Measure = { kind: "count", target: 12 };
  const state = { done: 4, target: 12, pct: 33, met: false, line: "" };
  it("turns a date into a weekly rate", () => {
    expect(paceLine(state, m, "2026-09-21", TODAY)).toBe("8 To go · About 2 a week");
    expect(paceLine(state, m, "2026-09-14", TODAY)).toBe("8 To go · About 2.7 a week");
  });
  it("counts days when the date is close, without capitalizing the unit", () => {
    expect(paceLine(state, m, "2026-08-30", TODAY)).toBe("8 To go · Due in 6 days");
    expect(paceLine(state, m, "2026-08-25", TODAY)).toBe("8 To go · Due tomorrow");
  });
  it("says today, and says past", () => {
    expect(paceLine(state, m, TODAY, TODAY)).toBe("8 To go · Due today");
    expect(paceLine(state, m, "2026-08-20", TODAY)).toBe("8 To go · Past its date");
  });
  it("has nothing to pace when it is met, undated, or a rhythm", () => {
    expect(paceLine({ ...state, met: true }, m, "2026-09-21", TODAY)).toBeNull();
    expect(paceLine(state, m, undefined, TODAY)).toBeNull();
    expect(paceLine(state, { kind: "cadence", times: 3, per: "week" }, "2026-09-21", TODAY)).toBeNull();
  });
});

describe("healthOf (pick 15)", () => {
  const met = { done: 12, target: 12, pct: 100, met: true, line: "" };
  const part = { done: 1, target: 12, pct: 8, met: false, line: "" };

  it("is done when the record says achieved, whatever the numbers", () => {
    expect(healthOf(goal({ state: "achieved" }), part, { kind: "count", target: 12 }, ctx(), 5)).toBe("done");
  });
  it("is done when the finish line is reached", () => {
    expect(healthOf(goal(), met, { kind: "count", target: 12 }, ctx(), 3)).toBe("done");
  });
  it("is behind once the date has passed", () => {
    expect(healthOf(goal({ by: "2026-08-01" }), part, { kind: "count", target: 12 }, ctx(), 3)).toBe("behind");
  });
  it("never claims behind without BOTH a date and a finish line", () => {
    expect(healthOf(goal(), part, { kind: "count", target: 12 }, ctx(), 3)).toBe("on_track");
    expect(healthOf(goal({ by: "2026-09-30" }), null, undefined, ctx(), 3)).toBe("unmeasured");
  });
  it("is behind when the seen rate is far under the rate the date needs", () => {
    const c = ctx({
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [{ id: "a", t: NOW - 2 * DAY }],
    });
    expect(healthOf(goal({ by: "2026-08-28" }), part, { kind: "count", target: 12 }, c, 3)).toBe("behind");
  });
  it("is idle only with evidence of neglect, never from silence", () => {
    const seen = ctx({
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [{ id: "a", t: NOW - (IDLE_DAYS + 3) * DAY }],
    });
    expect(healthOf(goal(), part, { kind: "count", target: 12 }, seen, 3)).toBe("idle");
    const silent = ctx({ reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null } });
    expect(idle(silent)).toBe(false);
  });
  it("says no measure rather than guessing", () => {
    expect(healthOf(goal(), null, undefined, ctx(), 0)).toBe("unmeasured");
  });
  it("calls a rhythm behind when the window is mostly gone and it is not", () => {
    // Sunday, one of three done.
    const sunday = new Date("2026-08-23T18:00:00").getTime();
    const c = ctx({
      now: sunday,
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [{ id: "a", t: sunday - DAY }],
    });
    const m: Measure = { kind: "cadence", times: 3, per: "week" };
    expect(healthOf(goal(), measureState(m, c), m, c, 2)).toBe("behind");
  });
});

describe("seenRate", () => {
  it("is completions per day over the last four weeks", () => {
    const c = ctx({
      reach: { filedIds: ["a"], taggedIds: [], openTagged: 0, progress: null },
      samples: [{ id: "a", t: NOW - DAY }, { id: "a", t: NOW - 3 * DAY }],
    });
    expect(seenRate(c)).toBeCloseTo(2 / 28, 5);
  });
});

describe("measureLabel", () => {
  it("names each kind in Title Case", () => {
    expect(measureLabel(undefined)).toBe("No Finish Line");
    expect(measureLabel({ kind: "count", target: 12 })).toBe("12 To Finish");
    expect(measureLabel({ kind: "cadence", times: 3, per: "week" })).toBe("3 A week");
    expect(measureLabel({ kind: "projects" })).toBe("Every Project Done");
    expect(measureLabel({ kind: "count", target: 12 }, 2000)).toBe("Dollar Target");
  });
});
