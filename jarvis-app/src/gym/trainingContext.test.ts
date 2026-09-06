import { describe, it, expect } from "vitest";
import { trainingLines } from "./trainingContext";
import { DEFAULT_BAR, DEFAULT_PLATES, type RackConfig } from "./ramp";
import type { Program, Workout, WorkoutData } from "./types";

// UP-ATH-19 (2026-09-06): until this landed, nothing in ai/, planDayAI or
// dayloop mentioned the gym at all, so the assistant planned an evening the
// athlete had already spent.

const RACK: RackConfig = { bar: DEFAULT_BAR, plates: [...DEFAULT_PLATES] };
const T = "2026-09-08"; // a Tuesday
const TUE = 2;
const MS = (iso: string, h = 17) => new Date(iso + "T00:00:00").getTime() + h * 3600000;

let n = 0;
function w(date: string, over: Partial<WorkoutData> = {}): Workout {
  n++;
  return {
    id: "w" + n,
    data: {
      programId: "p1", dayId: "d1", dayName: "Push Day", date,
      startedAt: MS(date), endedAt: MS(date) + 51 * 60000,
      exercises: [
        { exerciseId: "e-bench", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 185, r: 8 }] },
      ],
      ...over,
    },
  };
}

function program(over: Partial<Program["data"]> = {}): Program {
  return {
    id: "p1",
    data: {
      name: "Block A",
      weeks: [{
        id: "wk1",
        days: [{
          id: "d1",
          name: "Push Day",
          pinDays: [TUE],
          exercises: [
            { id: "x1", name: "Bench Press", kind: "weight_reps", unit: "lb", restSec: 120, sets: [{ w: 185, r: 8 }, { w: 185, r: 8 }, { w: 185, r: 8 }] },
          ],
        }],
      }],
      ...over,
    },
  } as Program;
}

describe("trainingLines", () => {
  it("says nothing at all when there is no program and no history", () => {
    expect(trainingLines({ program: null, workouts: [], today: T, dow: TUE, rack: RACK })).toEqual([]);
  });

  it("names the next planned day, when it is, and roughly how long it takes", () => {
    const lines = trainingLines({ program: program(), workouts: [], today: T, dow: TUE, rack: RACK });
    expect(lines[0]).toMatch(/^Next training day: Push Day today, about \d+ min planned$/);
  });

  it("states the last session with its date and real minutes", () => {
    const lines = trainingLines({ program: program(), workouts: [w("2026-09-05")], today: T, dow: TUE, rack: RACK });
    expect(lines).toContain("Last session: Push Day, Sep 5, 51 min");
  });

  it("counts the days trained this week, and never a run of them", () => {
    const lines = trainingLines({
      program: program(),
      workouts: [w("2026-09-07"), w("2026-09-08")],
      today: T, dow: TUE, rack: RACK,
    });
    expect(lines).toContain("Trained 2 days so far this week");
    for (const line of lines) {
      expect(line.toLowerCase()).not.toMatch(/\bstreak\b|\bin a row\b|\bbest\b/);
    }
  });

  it("states the season and the next game only when the athlete said which category is a game", () => {
    const inSeason = program({ inSeason: true, gameCategoryId: "cat-1" });
    expect(trainingLines({ program: inSeason, workouts: [], today: T, dow: TUE, rack: RACK })).toContain("In season");
    expect(trainingLines({ program: inSeason, workouts: [], today: T, dow: TUE, rack: RACK, nextGame: "2026-09-12" }))
      .toContain("In season, next game Sep 12");
    expect(trainingLines({ program: program(), workouts: [], today: T, dow: TUE, rack: RACK, nextGame: "2026-09-12" })
      .some((l) => l.includes("game"))).toBe(false);
  });

  it("names the routine's gym window when a pinned day has no calendar block, and stays quiet when it has one", () => {
    const base = { program: program(), workouts: [], today: T, dow: TUE, rack: RACK, gymWindow: { startMin: 18 * 60, endMin: 19 * 60 + 15 } };
    expect(trainingLines(base).some((l) => l.includes("6:00 PM to 7:15 PM"))).toBe(true);
    expect(trainingLines({ ...base, hasGymEventToday: true }).some((l) => l.includes("6:00 PM"))).toBe(false);
  });

  it("never advises, never reads the athlete, and never scores them", () => {
    const lines = trainingLines({
      program: program({ inSeason: true }),
      workouts: [w("2026-09-05"), w("2026-09-07")],
      today: T, dow: TUE, rack: RACK,
      gymWindow: { startMin: 18 * 60, endMin: 19 * 60 },
    });
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const word of ["should", "deload", "taper", "readiness", "recovery", "fatigue", "ready", "rest up"]) {
      expect(lines.join(" ").toLowerCase(), word + " has no place in a facts-only context").not.toContain(word);
    }
  });
});
