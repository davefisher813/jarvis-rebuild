// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthBody from "./HealthBody";
import type { Program, Workout } from "../gym/types";
import { SCRATCH_DAY_ID } from "../gym/nextDay";
import { periodFor, periodOverview } from "../insights/analytics";

// WORKOUT FIRST (Dave 2026-10-09, items 1 and 2, mockup 1): "Most people
// don't have programs. Stop assuming a Program on the Health screen." "Add a
// prominent Start Workout CTA on the Health screen, same visual weight as the
// red Log button, thumb-reachable. One tap starts a workout." And the
// workouts he has done, under the doors.
afterEach(cleanup);

const program = {
  id: "p1", entityType: "program",
  data: { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [
    { id: "d1", name: "push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", sets: [] }] },
  ] }] },
} as unknown as Program;

const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, "0")}:00:00`).getTime();
const workout = (id: string, date: string, dayName: string, minutes: number, names: string[]): Workout => ({
  id, data: {
    programId: "", dayId: SCRATCH_DAY_ID, dayName, date, startedAt: at(date, 8), endedAt: at(date, 8) + minutes * 60_000,
    exercises: names.map((n, i) => ({ exerciseId: "x" + i, name: n, kind: "weight_reps", sets: [{ id: "s" + i, w: 100, r: 5 }] })),
  },
});
const today = "2026-10-10";
const base = {
  program: null, workouts: [] as Workout[], today, isEvening: false, gymEvent: null,
  overview: periodOverview([], null, [], periodFor("7d", today)),
  findings: [], logActions: [],
  onStart: () => {}, onAdjustTime: () => {}, onOpenGym: () => {}, onOpenRecords: () => {}, onOpenFinding: () => {},
  view: "health" as const, onView: () => {},
};

describe("Start Workout leads the Health page", () => {
  it("with no program, is the first card, wears the Log button's classes, and starts an empty workout in one tap", () => {
    const onStart = vi.fn();
    const { container } = render(<HealthBody {...base} onStart={onStart} />);
    const btn = screen.getByRole("button", { name: "Start Workout" });
    // The session's Log button is `.btn.btn-primary.btn-launch.btn-lg`: the same weight.
    expect(btn).toHaveClass("btn", "btn-primary", "btn-launch", "btn-lg", "btn-block");
    expect(container.innerHTML.indexOf("h-hero-card")).toBeLessThan(container.innerHTML.indexOf("h-week-card"));
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledWith(SCRATCH_DAY_ID);
    // Nothing on the page asks for a program.
    expect(screen.queryByText("Set Up a Program")).toBeNull();
    expect(screen.queryByText("Next in Your Program")).toBeNull();
    expect(screen.getByText("Ready to Train")).toBeInTheDocument();
  });

  it("with a program, still starts an empty workout, and offers the program's next day as a row under it", () => {
    const onStart = vi.fn();
    render(<HealthBody {...base} program={program} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Workout" }));
    expect(onStart).toHaveBeenLastCalledWith(SCRATCH_DAY_ID);
    expect(screen.getByText("Next in Your Program")).toHaveClass("h-eyebrow");
    const row = screen.getByText("Push").closest('[role="button"]') as HTMLElement;
    expect(row.querySelector(".chev")).not.toBeNull();
    fireEvent.click(row);
    const sheet = document.querySelector(".sheet-scrim") as HTMLElement;
    fireEvent.click(within(sheet).getByRole("button", { name: "Start Workout" }));
    expect(onStart).toHaveBeenLastCalledWith("d1");
  });

  it("while a workout is open, says so and resumes it, with no second start", () => {
    const onResume = vi.fn();
    render(<HealthBody {...base} live={{ dayName: "workout", nextExercise: "Bench Press", setNo: 1, setTotal: 3, logged: 2 }} onResume={onResume} />);
    expect(screen.getByText("Workout in Progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Workout" })).toBeNull();
    const resume = screen.getByRole("button", { name: "Resume Workout" });
    expect(resume).toHaveClass("btn-primary", "btn-launch", "btn-lg");
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalled();
  });
});

describe("Recent Workouts", () => {
  const four = [
    workout("a", "2026-10-02", "Workout", 40, ["Squat"]),
    workout("b", "2026-10-09", "push day", 52, ["Bench Press", "Dips", "Flys"]),
    workout("c", "2026-10-06", "Workout", 30, ["Row"]),
    workout("d", "2026-10-08", "Workout", 45, ["Squat", "Lunge"]),
  ];

  it("lists the three newest, each a door to its workout, with its date, what was logged and how long", () => {
    const onOpenWorkout = vi.fn();
    render(<HealthBody {...base} workouts={four} onOpenWorkout={onOpenWorkout} onOpenHistory={() => {}} />);
    const head = screen.getByText("Recent Workouts").closest(".sh2") as HTMLElement;
    const card = head.nextElementSibling as HTMLElement;
    const rows = [...card.querySelectorAll('.row[role="button"]')] as HTMLElement[];
    expect(rows.map((r) => r.querySelector(".conn-name")!.textContent)).toEqual(["Push Day", "Workout", "Workout"]);
    const facts = [...rows[0]!.querySelectorAll(".fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["Oct 9", "3 Exercises", "52 Min"]);
    expect(facts[0]).toHaveClass("date");
    expect(facts[1]).toHaveClass("lime");
    // One grey per row: only the length is an untoned fact, and no fact carries a typed dot.
    expect(facts.filter((f) => f.className === "fact")).toHaveLength(1);
    for (const f of facts) expect(f.textContent).not.toMatch(/[·•]/);
    fireEvent.click(rows[0]!);
    expect(onOpenWorkout).toHaveBeenCalledWith("b");
  });

  it("See All opens History", () => {
    const onOpenHistory = vi.fn();
    render(<HealthBody {...base} workouts={four} onOpenWorkout={() => {}} onOpenHistory={onOpenHistory} />);
    const head = screen.getByText("Recent Workouts").closest(".sh2") as HTMLElement;
    const all = within(head).getByRole("button", { name: "See All" });
    expect(all).toHaveClass("see-all", "pill-action");
    fireEvent.click(all);
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it("is not drawn with no workout, or without a door to open one", () => {
    render(<HealthBody {...base} onOpenWorkout={() => {}} />);
    expect(screen.queryByText("Recent Workouts")).toBeNull();
    cleanup();
    render(<HealthBody {...base} workouts={four} />);
    expect(screen.queryByText("Recent Workouts")).toBeNull();
  });
});
