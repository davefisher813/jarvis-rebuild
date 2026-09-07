import { describe, it, expect, beforeEach } from "vitest";
import { deriveCompletionWindow, deriveSlipCategory, derivePlanRate, deriveAll } from "./derive";
import { setCategoryRegistry } from "../shared/categories";
import type { WindowRow } from "./window";

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "task.completed", day: "2026-08-20", h: 10, category: null, n: null, flag: null, kind: null, ...over,
});

// n completions at hour h, spread over distinct days so evidence is real.
const done = (n: number, h: number, from = 1): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ h, day: `2026-08-${String(from + (i % 20)).padStart(2, "0")}` }));

describe("completion window", () => {
  it("says nothing under ten completions, however lopsided", () => {
    expect(deriveCompletionWindow(done(9, 10))).toBeNull();
  });

  it("says nothing when no band dominates", () => {
    // 20 completions spread evenly across the clock: a real person with no pattern.
    const rows = Array.from({ length: 20 }, (_, i) => row({ h: i, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    expect(deriveCompletionWindow(rows)).toBeNull();
  });

  it("names the band and shows its own count when the evidence is real", () => {
    const d = deriveCompletionWindow([...done(12, 10), ...done(4, 20, 5)])!;
    expect(d.derivation).toBe("completion_window");
    expect(d.category).toBe("energy");
    // Ties break to the earliest qualifying band, so a 10 AM mass reads as
    // the 8 to 11 window. The band contains the hour; it does not start on it.
    expect(d.title).toBe("Your tasks get done between 8 AM and 11 AM");
    // The casing law owns the word behind a leading count.
    expect(d.sub).toBe("12 Finishes there, out of your last 16");
    expect(d.evidence.length).toBeGreaterThan(0);
    expect(d.evidence.length).toBeLessThanOrEqual(6);
  });

  // BRAIN-F-18 (2026-09-05): the band's end is start + 3, so a late band
  // handed 24 to the clock formatter, which read `h < 12` and called midnight
  // PM: "Your tasks get done between 9 PM and 12 PM".
  it("a late band ends at midnight, and midnight is AM", () => {
    const d = deriveCompletionWindow(done(12, 23))!;
    expect(d.title).toBe("Your tasks get done between 9 PM and 12 AM");
    expect(d.strandText).toContain("12 AM");
  });

  it("never carries free text into evidence, only a day and numbers", () => {
    const d = deriveCompletionWindow(done(12, 9))!;
    for (const e of d.evidence) {
      expect(Object.keys(e).sort()).toEqual(["a", "day"]);
      expect(typeof e.day).toBe("string");
    }
  });

  it("a month of gym evenings is not a task pattern: kind workout is excluded", () => {
    // 12 real completions at 10 AM, 30 gym sessions at 6 PM. Without the
    // filter the band would name the gym. With it, the mornings win and the
    // count is the task count.
    const gym = Array.from({ length: 30 }, (_, i) => row({ h: 18, kind: "workout", day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    const d = deriveCompletionWindow([...done(12, 10), ...gym])!;
    expect(d.title).toBe("Your tasks get done between 8 AM and 11 AM");
    expect(d.sub).toBe("12 Finishes there, out of your last 12");
    // And sessions alone never produce the derivation at all.
    expect(deriveCompletionWindow(gym)).toBeNull();
  });
});

describe("slip by category", () => {
  // BRAIN-F-05 (2026-09-05): task.pushed carries the category ID, not its
  // name. The old fixture fed "Money" and so asserted the wrong contract; the
  // derivation printed a uuid on the Today card. Ids in, names out.
  const MONEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const HOME = "9b2c1d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
  beforeEach(() => {
    setCategoryRegistry([
      { id: MONEY, name: "Money", color: "green" },
      { id: HOME, name: "Home", color: "blue" },
    ]);
  });

  const push = (cat: string, n: number, from = 1): WindowRow[] =>
    Array.from({ length: n }, (_, i) => row({ type: "task.pushed", category: cat, day: `2026-08-${String(from + i).padStart(2, "0")}` }));

  it("stays quiet under five pushes", () => {
    expect(deriveSlipCategory(push(MONEY, 4))).toBeNull();
  });

  it("stays quiet when two categories slip about the same amount", () => {
    expect(deriveSlipCategory([...push(MONEY, 6), ...push(HOME, 5, 10)])).toBeNull();
  });

  it("names the leader by its NAME when it doubles the runner up", () => {
    const d = deriveSlipCategory([...push(MONEY, 8), ...push(HOME, 2, 12)])!;
    expect(d.title).toBe("Money tasks are the ones that slip");
    expect(d.strandText).toBe("Money tasks tend to slip and need extra room");
    expect(d.sub).toContain("8 times");
    expect(d.category).toBe("work_style");
    // And never the id, in any of the three lines.
    expect(`${d.title} ${d.sub} ${d.strandText}`).not.toContain(MONEY);
  });

  it("says nothing about a category that no longer exists", () => {
    setCategoryRegistry([]);
    expect(deriveSlipCategory(push(MONEY, 8))).toBeNull();
  });

  it("speaks with a sole leader and no runner up at all", () => {
    expect(deriveSlipCategory(push(MONEY, 5))).not.toBeNull();
  });

  it("never scolds: no guilt vocabulary anywhere in the copy", () => {
    const d = deriveSlipCategory([...push(MONEY, 8), ...push(HOME, 2, 12)])!;
    const all = `${d.title} ${d.sub} ${d.strandText}`.toLowerCase();
    for (const banned of ["should", "failed", "fail", "behind", "neglect", "bad", "lazy", "again"]) {
      expect(all).not.toContain(banned);
    }
  });
});

describe("plan versus done", () => {
  const outcome = (flagged: boolean, day: string): WindowRow => row({ type: "plan.outcome", flag: flagged, day });
  const outcomes = (doneN: number, missN: number): WindowRow[] => [
    ...Array.from({ length: doneN }, (_, i) => outcome(true, `2026-08-${String((i % 20) + 1).padStart(2, "0")}`)),
    ...Array.from({ length: missN }, (_, i) => outcome(false, `2026-08-${String((i % 20) + 1).padStart(2, "0")}`)),
  ];

  it("stays quiet under ten picks", () => {
    expect(derivePlanRate(outcomes(6, 3))).toBeNull();
  });

  it("stays quiet in the middle, because an ordinary rate is not a pattern", () => {
    expect(derivePlanRate(outcomes(6, 6))).toBeNull();
  });

  it("celebrates a strong rate", () => {
    const d = derivePlanRate(outcomes(9, 2))!;
    expect(d.title).toBe("What you plan, you finish");
    expect(d.strandText).toContain("Finishes");
  });

  it("states a weak rate as a fact about plan size, never as a failing", () => {
    const d = derivePlanRate(outcomes(2, 10))!;
    expect(d.title).toBe("Shorter plans fit your real days better");
    const all = `${d.title} ${d.sub} ${d.strandText}`.toLowerCase();
    for (const banned of ["should", "failed", "only", "behind"]) expect(all).not.toContain(banned);
  });

  it("counts ONLY the locked definition: a row with no flag is not a pick", () => {
    const noFlags = Array.from({ length: 12 }, () => row({ type: "plan.outcome", flag: null }));
    expect(derivePlanRate(noFlags)).toBeNull();
  });

  it("carries done-of-picked in the receipts", () => {
    const d = derivePlanRate(outcomes(9, 2))!;
    expect(d.evidence.every((e) => typeof e.a === "number" && typeof e.b === "number")).toBe(true);
  });
});

describe("deriveAll", () => {
  it("says nothing at all on an empty log", () => {
    expect(deriveAll([])).toEqual([]);
  });

  it("returns only the derivations the evidence supports", () => {
    const rows = [...deriveFixtureCompletions()];
    const out = deriveAll(rows);
    expect(out.map((d) => d.derivation)).toEqual(["completion_window"]);
  });
});

function deriveFixtureCompletions(): WindowRow[] {
  return done(14, 9);
}

// THE BRAIN STOPS STARVING (build handoff item 1 and 3, built 2026-09-04).
// Two new detectors under the gates the original four already use.
import { deriveTrainingWindow, deriveEmailWindow, workoutDone, emailHandled, taskDone, completionBand } from "./derive";

const taskDoneCount = (rows: WindowRow[]) => taskDone(rows).length;

const workouts = (n: number, h: number, from = 1): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ h, kind: "workout", day: `2026-08-${String(from + (i % 20)).padStart(2, "0")}` }));

const handled = (n: number, h: number, from = 1): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ type: "email.handled", h, kind: "archive", day: `2026-08-${String(from + (i % 20)).padStart(2, "0")}` }));

describe("training window: the rows that were captured and read by nobody", () => {
  it("reads the workout rows every other derivation throws away", () => {
    // The whole point. deriveCompletionWindow filters kind "workout" out on
    // purpose (a session is not a task) and until now nothing else looked,
    // so a month of real training taught the Brain nothing at all.
    const rows = workouts(12, 18);
    expect(deriveCompletionWindow(rows)).toBeNull();
    expect(deriveTrainingWindow(rows)).not.toBeNull();
  });

  it("names the band with its own count", () => {
    const d = deriveTrainingWindow([...workouts(12, 18), ...workouts(4, 7, 5)])!;
    expect(d.derivation).toBe("training_window");
    expect(d.category).toBe("routine");
    // The band ties to the EARLIEST containing window, which is the
    // documented behaviour a launch test already pins: a 6 PM mass reads
    // as "between 4 PM and 7 PM".
    expect(d.title).toBe("You train between 4 PM and 7 PM");
    expect(d.sub).toContain("12 Sessions there");
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it("holds the same gates: thin evidence and no dominant band both say nothing", () => {
    expect(deriveTrainingWindow(workouts(9, 18))).toBeNull();
    const spread = Array.from({ length: 20 }, (_, i) => row({ h: i, kind: "workout", day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    expect(deriveTrainingWindow(spread)).toBeNull();
  });

  it("never counts a task as a session, or a session as a task", () => {
    expect(workoutDone(done(5, 10))).toHaveLength(0);
    expect(taskDoneCount(workouts(5, 18))).toBe(0);
  });
});

describe("email window: the module that did the most and said the least", () => {
  it("names the band once the evidence is real", () => {
    const d = deriveEmailWindow([...handled(12, 9), ...handled(3, 20, 5)])!;
    expect(d.derivation).toBe("email_window");
    expect(d.category).toBe("work_style");
    expect(d.title).toBe("Email gets dealt with between 7 AM and 10 AM");
    expect(d.strandText).toContain("Deals with email");
  });

  it("holds the same gates", () => {
    expect(deriveEmailWindow(handled(9, 9))).toBeNull();
  });

  it("reads only email.handled, never a task completion at the same hour", () => {
    expect(emailHandled(done(12, 9))).toHaveLength(0);
    expect(deriveEmailWindow(done(12, 9))).toBeNull();
  });
});

describe("deriveAll carries the new detectors", () => {
  it("offers training and email alongside the launch four", () => {
    const keys = deriveAll([...done(12, 10), ...workouts(12, 18), ...handled(12, 9)]).map((d) => d.derivation);
    expect(keys).toContain("completion_window");
    expect(keys).toContain("training_window");
    expect(keys).toContain("email_window");
  });
});

// NO PATTERN IS A FACT (Dave, 2026-09-07). 158 completions, no band, and
// every AI prompt got nothing about when his work lands. These pin the
// absence detector to the SAME evidence bar as the fact it answers for, and
// pin the pair as mutually exclusive: exactly one of them can ever speak.
import { deriveCompletionNoBand, bestBand, MIN_COMPLETIONS } from "./derive";

// Dave's own shape, scaled down: completions on every hour of the clock, so
// no 3-hour stretch comes near 40 percent of them.
const flat = (n: number): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ h: i % 24, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

describe("no pattern: completions with no band", () => {
  it("says nothing below the count gate, however flat the day", () => {
    // The whole point of the count gate: "no pattern in nine completions" is
    // not a finding, it is an empty month.
    expect(deriveCompletionNoBand(flat(MIN_COMPLETIONS - 1))).toBeNull();
  });

  it("speaks at the same count gate its twin needs, and not one row earlier", () => {
    expect(deriveCompletionNoBand(flat(MIN_COMPLETIONS - 1))).toBeNull();
    expect(deriveCompletionNoBand(flat(MIN_COMPLETIONS))).not.toBeNull();
  });

  it("says the exact sentence that goes into the genome", () => {
    const d = deriveCompletionNoBand(flat(24))!;
    expect(d.derivation).toBe("completion_no_band");
    expect(d.category).toBe("energy");
    expect(d.title).toBe("Your tasks get done across the whole day");
    // 24 completions, one per hour: the fullest 3-hour stretch holds 3.
    expect(d.sub).toBe("3 Finishes in the fullest 3-hour stretch, out of your last 24");
    expect(d.strandText).toBe("Finishes things across the whole day rather than in one stretch");
  });

  it("carries no receipts, because an absence has no day to point at", () => {
    // deriveGoneQuiet already ships evidence: [] for the same reason. Six
    // recent days under a fact that says nothing is banded would be either
    // cherry-picked or misleading, and no receipt beats a misleading one.
    expect(deriveCompletionNoBand(flat(24))!.evidence).toEqual([]);
  });

  it("stays quiet when there IS a band, so the positive fact speaks alone", () => {
    const banded = [...done(12, 10), ...done(4, 20, 5)];
    expect(deriveCompletionWindow(banded)).not.toBeNull();
    expect(deriveCompletionNoBand(banded)).toBeNull();
  });

  it("a month of gym evenings is not a flat day of tasks", () => {
    // taskDone drops kind "workout", so 30 sessions cannot carry this over
    // its count gate any more than they can carry the positive twin over it.
    const gym = Array.from({ length: 30 }, (_, i) => row({ h: 18, kind: "workout", day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));
    expect(deriveCompletionNoBand(gym)).toBeNull();
  });

  it("deriveAll offers one answer to the question, never both", () => {
    const flatKeys = deriveAll(flat(24)).map((d) => d.derivation);
    expect(flatKeys).toContain("completion_no_band");
    expect(flatKeys).not.toContain("completion_window");
    const bandedKeys = deriveAll([...done(12, 10), ...done(4, 20, 5)]).map((d) => d.derivation);
    expect(bandedKeys).toContain("completion_window");
    expect(bandedKeys).not.toContain("completion_no_band");
  });
});

describe("bestBand: one definition of the fullest stretch", () => {
  it("answers the same start and count completionBand does when a band exists", () => {
    const rows = [...done(12, 10), ...done(4, 20, 5)];
    expect(bestBand(taskDone(rows))).toEqual(completionBand(taskDone(rows)));
  });

  it("still answers when nothing dominates, which is what the absence reports", () => {
    const rows = taskDone(flat(24));
    expect(completionBand(rows)).toBeNull();
    expect(bestBand(rows).count).toBe(3);
  });
});

// The second half of the 2026-09-07 ruling. 66 pushes and no area in front,
// so slip_category says nothing and the model is free to pick an area. The
// true answer is that it is across the board.
import { deriveSlipNoLeader, MIN_SLIPS_LEADER } from "./derive";

const pushed = (cat: string, n: number, from = 1): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ type: "task.pushed", category: cat, day: `2026-08-${String(from + (i % 20)).padStart(2, "0")}` }));

describe("no pattern: pushes with no area in front", () => {
  beforeEach(() => {
    setCategoryRegistry([
      { id: "cat-admin", name: "Admin", color: "blue" },
      { id: "cat-home", name: "Home", color: "green" },
      { id: "cat-work", name: "Work", color: "red" },
    ]);
  });

  it("says nothing below the count gate, however level the areas", () => {
    const rows = [...pushed("cat-admin", MIN_SLIPS_LEADER - 1), ...pushed("cat-home", MIN_SLIPS_LEADER - 1)];
    expect(deriveSlipNoLeader(rows)).toBeNull();
  });

  it("speaks at the same count gate its twin needs, and not one push earlier", () => {
    const under = [...pushed("cat-admin", MIN_SLIPS_LEADER - 1), ...pushed("cat-home", MIN_SLIPS_LEADER - 1)];
    const on = [...pushed("cat-admin", MIN_SLIPS_LEADER), ...pushed("cat-home", MIN_SLIPS_LEADER)];
    expect(deriveSlipNoLeader(under)).toBeNull();
    expect(deriveSlipNoLeader(on)).not.toBeNull();
  });

  it("says the exact sentence that goes into the genome", () => {
    const d = deriveSlipNoLeader([...pushed("cat-admin", 15), ...pushed("cat-home", 14), ...pushed("cat-work", 13)])!;
    expect(d.derivation).toBe("slip_no_leader");
    expect(d.category).toBe("work_style");
    expect(d.title).toBe("Tasks slip across every area, not one");
    expect(d.sub).toBe("Pushed 15 times in the busiest area, 14 in the next");
    expect(d.strandText).toBe("Tasks slip across every area, none more than the rest");
    expect(d.evidence).toEqual([]);
  });

  it("names no area, so it survives a category nobody can name any more", () => {
    // Its twin needs catName and goes silent without one. This one says
    // nothing about any single area, so there is nothing to resolve, and
    // naming one would contradict the fact it is stating.
    setCategoryRegistry([]);
    const rows = [...pushed("cat-admin", 8), ...pushed("cat-home", 7)];
    expect(deriveSlipCategory(rows)).toBeNull();
    const d = deriveSlipNoLeader(rows)!;
    expect(d).not.toBeNull();
    expect(d.title).not.toContain("cat-");
    expect(d.strandText).not.toContain("cat-");
  });

  it("stays quiet when one area DOES lead, so the positive fact speaks alone", () => {
    const leading = [...pushed("cat-admin", 12), ...pushed("cat-home", 3)];
    expect(deriveSlipCategory(leading)).not.toBeNull();
    expect(deriveSlipNoLeader(leading)).toBeNull();
  });

  it("stays quiet when a leader exists that JARVIS cannot name", () => {
    // A pattern nobody can name is still a pattern. Saying "it is everywhere"
    // over the top of it would be false, so both halves stay silent and the
    // readiness row says why.
    setCategoryRegistry([{ id: "cat-home", name: "Home", color: "green" }]);
    const rows = [...pushed("3fa85f64-5717-4562-b3fc-2c963f66afa6", 12), ...pushed("cat-home", 3)];
    expect(deriveSlipCategory(rows)).toBeNull();
    expect(deriveSlipNoLeader(rows)).toBeNull();
  });

  it("a single area over the gate is a leader, never an absence", () => {
    expect(deriveSlipNoLeader(pushed("cat-admin", 9))).toBeNull();
    expect(deriveSlipCategory(pushed("cat-admin", 9))).not.toBeNull();
  });

  it("deriveAll offers one answer to the question, never both", () => {
    const level = deriveAll([...pushed("cat-admin", 15), ...pushed("cat-home", 14)]).map((d) => d.derivation);
    expect(level).toContain("slip_no_leader");
    expect(level).not.toContain("slip_category");
    const leading = deriveAll([...pushed("cat-admin", 12), ...pushed("cat-home", 3)]).map((d) => d.derivation);
    expect(leading).toContain("slip_category");
    expect(leading).not.toContain("slip_no_leader");
  });
});
