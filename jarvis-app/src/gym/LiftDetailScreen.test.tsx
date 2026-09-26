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

const chestMap = new Map<string, MuscleGroup[]>([
  ["Incline Press", ["chest"]], ["Bench Press", ["chest"]], ["Dips", ["chest"]], ["Rows", ["back"]],
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

  // 2026-09-14: the two numbers became two separate CELLS rather than a
  // sentence and a follow-up line, and the heading stopped saying "hard sets"
  // -- nothing in this app records whether a set was taken near failure, so
  // calling them hard asserts something the data does not carry.
  it("sums every lift that trains the muscle, the way the Health page does", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getByText("Chest Working Sets")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.queryByText(/Hard Sets/)).toBeNull();
  });

  it("names this lift's own share, so neither number is a mystery", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getByText("This Exercise")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("states the window the numbers cover rather than saying this week", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.getAllByText(/ to /).length).toBeGreaterThan(0);
    expect(screen.getByText("Warm-ups and drop sets left out")).toBeInTheDocument();
  });

  it("keeps the research behind its own disclosure, apart from the recorded total", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.queryByText(/Schoenfeld/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence and Calculation" }));
    expect(screen.getByText(/Schoenfeld/)).toBeInTheDocument();
  });

  // §AM (2026-09-26): the count and how it counts are one fact, the number
  // in white, and a primary lift (the default) says nothing more.
  it("lists the sets behind the number on tap", () => {
    render(<LiftDetailScreen {...base} workouts={workouts} muscleGroup="chest" muscleMap={chestMap} />);
    expect(screen.queryByText("Bench Press")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Contributing Sets" }));
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    const count = screen.getAllByText((_, el) => !!el?.classList.contains("fact") && el.textContent === "6 sets");
    expect(count.length).toBe(1);
    expect(count[0]!.querySelector("b")?.textContent).toBe("6");
    expect(screen.queryByText("Primary")).toBeNull();
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

// Health Push E: H-31 the caption, H-34 tap a point.
describe("LiftDetailScreen: the chart says what it is, and answers a tap", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  const two = [workout("2026-08-26", [{ name: "Incline Press", sets: 3 }]), workout("2026-09-02", [{ name: "Incline Press", sets: 3 }])];

  it("the caption names Epley, says it is not a tested max, and carries the unit", () => {
    render(<LiftDetailScreen {...base} workouts={two} />);
    expect(screen.getByText("Est 1RM (Epley), not a tested max, lb")).toBeInTheDocument();
  });

  // AMENDED 2026-09-16 (Dave: "uniform everything"). The three readings were
  // one span carrying two middots of its own, which is a sentence with
  // punctuation in it -- components.css draws the separator so no string has
  // to. AMENDED 2026-09-26 (§AM): the date is a neutral date, so small caps
  // (.fact.date) rather than the health "now" hue; the estimate wears the
  // estimate primitive (sky); the set between them is the line's one grey.
  it("tapping a point reads its date, set, and estimate as three facts", () => {
    render(<LiftDetailScreen {...base} workouts={two} />);
    expect(screen.queryByText(/^Est \d+ lb$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Session 1 of 2" }));
    // The date appears in the Milestones card too, so read the one in the
    // chart's own facts line, which sits beside the estimate.
    const est = screen.getByText(/^Est \d+ lb$/);
    expect(est, "the estimate wears the estimate primitive").toHaveClass("fact", "est");
    const line = est.parentElement!;
    const date = line.querySelector(".fact.date")!;
    expect(date.textContent, "the date is small caps on the same line").toBe("Aug 26");
    expect(line.querySelectorAll(".fact.cyan").length, "no health hue on a neutral date").toBe(0);
    // The separator is the CSS's, never the string's.
    expect(line.textContent).not.toMatch(/\u00b7/);
  });
});

// 2026-09-14 (the reference's Exercise progress page): the best recorded set
// leads, with its date and the session count, and the Epley estimate waits
// behind a row, labelled as an estimate.
describe("LiftDetailScreen: best recorded set and milestones", () => {
  it("leads with the best set, counts the sessions, and shows the estimate on tap", () => {
    const workouts = [
      { id: "w1", data: { programId: "p", dayId: "d", dayName: "Push", date: "2026-09-01", startedAt: 1, endedAt: 2, exercises: [{ exerciseId: "e", name: "Incline Bench", kind: "weight_reps", unit: "lb", sets: [{ id: "a", w: 125, r: 5 }] }] } },
      { id: "w2", data: { programId: "p", dayId: "d", dayName: "Push", date: "2026-09-07", startedAt: 1, endedAt: 2, exercises: [{ exerciseId: "e", name: "Incline Bench", kind: "weight_reps", unit: "lb", sets: [{ id: "b", w: 135, r: 5 }] }] } },
    ] as never;
    render(<LiftDetailScreen name="Incline Bench" kind="weight_reps" unit="lb" workouts={workouts} defs={[]} logs={[]} onSetGoal={() => {}} onBack={() => {}} />);
    // 2026-09-14: the sentence became three labelled cells (§7), under one
    // Performance and History head.
    expect(screen.getByText("Performance and History")).toBeInTheDocument();
    expect(screen.getByText("Best Set")).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getAllByText("Sessions").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Estimated One-Rep Max"));
    expect(screen.getAllByText("158 lb").length).toBeGreaterThan(0);
    expect(screen.getByText("First Session")).toBeInTheDocument();
  });
});
