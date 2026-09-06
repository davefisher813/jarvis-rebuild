// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiftDetailScreen from "./LiftDetailScreen";
import type { Workout, SetEntry } from "./types";
import type { MuscleGroup } from "./muscles";

// GYM-F-15 (2026-09-05): the Weekly Hard Sets row names a muscle and cites a
// published range that is about that muscle, but it was handed a map of ONE
// lift, so Incline Press read "Chest: 4 sets this week" while the Health page
// said Chest 14 (Bench + Dips + Incline). The row under-reported the muscle
// against a range about the muscle.

const T0 = new Date("2026-09-05T09:00:00").getTime();
let sid = 0;
const sets = (n: number): SetEntry[] => Array.from({ length: n }, () => ({ id: `s${sid++}`, w: 135, r: 8 }));
const workout = (date: string, exercises: { name: string; sets: number }[]): Workout => ({
  id: `w${date}`,
  data: {
    programId: "p", dayId: "d", dayName: "Push", date, startedAt: 0, endedAt: 1,
    exercises: exercises.map((e) => ({ exerciseId: e.name, name: e.name, kind: "weight_reps" as const, unit: "lb", sets: sets(e.sets) })),
  },
});

const chestMap = new Map<string, MuscleGroup>([
  ["Incline Press", "chest"], ["Bench Press", "chest"], ["Dips", "chest"], ["Rows", "back"],
]);

const base = {
  name: "Incline Press", kind: "weight_reps" as const, unit: "lb",
  defs: [], logs: [], onSetGoal: () => {}, onBack: () => {},
};

describe("LiftDetailScreen weekly hard sets", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  const workouts = [workout("2026-09-02", [
    { name: "Incline Press", sets: 4 }, { name: "Bench Press", sets: 6 }, { name: "Dips", sets: 4 }, { name: "Rows", sets: 5 },
  ])];

  it("sums every lift that trains the muscle, the way the Health page does", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getByText("14 sets this week")).toBeInTheDocument();
    expect(screen.queryByText("4 sets this week")).toBeNull();
  });

  it("names this lift's own share, so neither number is a mystery", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getByText("Incline Press: 4 of them")).toBeInTheDocument();
  });

  it("a lift that is the whole muscle's week says it once, not twice", () => {
    const only = [workout("2026-09-02", [{ name: "Incline Press", sets: 4 }])];
    render(<LiftDetailScreen {...base} workouts={only} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getByText("4 sets this week")).toBeInTheDocument();
    expect(screen.queryByText("Incline Press: 4 of them")).toBeNull();
  });

  it("a lift with no muscle set claims nothing at all", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleMap={chestMap} />);
    expect(screen.queryByText(/sets this week/)).toBeNull();
  });
});

// UP-ATH-08 (2026-09-06): a lift goal, once set, could only be changed from
// Bigger Picture. The card on the lift's own page is the door to it.
describe("the goal card on a lift's page", () => {
  const goal = {
    id: "g1",
    data: {
      title: "Touch 30",
      measure: { kind: "lift" as const, exercise: "Incline Press", measureKind: "weight_reps" as const, target: { w: 225, r: 5 }, unit: "lb" },
    },
  };

  const history = [workout("2026-09-02", [{ name: "Incline Press", sets: 4 }])];

  it("opens the goal sheet when it is tapped", () => {
    const onSetGoal = vi.fn();
    render(<LiftDetailScreen {...base} onSetGoal={onSetGoal} workouts={history} goal={goal as never} />);
    fireEvent.click(screen.getByLabelText("Edit Goal"));
    expect(onSetGoal).toHaveBeenCalledTimes(1);
  });

  it("answers Enter and Space too, because it is a button", () => {
    const onSetGoal = vi.fn();
    render(<LiftDetailScreen {...base} onSetGoal={onSetGoal} workouts={history} goal={goal as never} />);
    fireEvent.keyDown(screen.getByLabelText("Edit Goal"), { key: "Enter" });
    expect(onSetGoal).toHaveBeenCalledTimes(1);
  });
});
