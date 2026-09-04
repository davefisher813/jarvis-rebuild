import { describe, it, expect } from "vitest";
import { deriveCompletionWindow, deriveSlipCategory, derivePlanRate, deriveAll } from "./derive";
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
  const push = (cat: string, n: number, from = 1): WindowRow[] =>
    Array.from({ length: n }, (_, i) => row({ type: "task.pushed", category: cat, day: `2026-08-${String(from + i).padStart(2, "0")}` }));

  it("stays quiet under five pushes", () => {
    expect(deriveSlipCategory(push("Money", 4))).toBeNull();
  });

  it("stays quiet when two categories slip about the same amount", () => {
    expect(deriveSlipCategory([...push("Money", 6), ...push("Home", 5, 10)])).toBeNull();
  });

  it("names the leader when it doubles the runner up", () => {
    const d = deriveSlipCategory([...push("Money", 8), ...push("Home", 2, 12)])!;
    expect(d.title).toBe("Money tasks are the ones that slip");
    expect(d.sub).toContain("8 times");
    expect(d.category).toBe("work_style");
  });

  it("speaks with a sole leader and no runner up at all", () => {
    expect(deriveSlipCategory(push("Money", 5))).not.toBeNull();
  });

  it("never scolds: no guilt vocabulary anywhere in the copy", () => {
    const d = deriveSlipCategory([...push("Money", 8), ...push("Home", 2, 12)])!;
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
import { deriveTrainingWindow, deriveEmailWindow, workoutDone, emailHandled, taskDone } from "./derive";

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
