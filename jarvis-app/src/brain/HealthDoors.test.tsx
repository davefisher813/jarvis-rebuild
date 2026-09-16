// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthBody from "./HealthBody";
import type { Program, Workout } from "../gym/types";
import { periodFor, periodOverview } from "../insights/analytics";

// THE THREE DOORS (Dave, 2026-09-14: "Add a visible shortcut row near the top
// of Health, immediately below the weekly overview: Exercises · Program ·
// History. Exercises must open the complete library in one tap. Do not bury it
// inside a program or More menu.")
//
// Before this, Exercises was two taps and a guess: Open the Program, then find
// a row inside it. That is most of why a library of a hundred and fifty
// exercises sat unclassified, and why the Weekly Volume card had almost nothing
// to say. Landed on the approved Health design (the week card first, then the
// doors, then Next Workout).

const program: Program = {
  id: "p1", entityType: "program",
  data: { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [
    { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", sets: [] }] },
    { id: "d2", name: "Pull", exercises: [{ id: "e2", name: "Row", kind: "weight_reps", sets: [] }] },
  ] }] },
} as unknown as Program;

const workouts: Workout[] = [
  { id: "w1", entityType: "workout", data: { programId: "p1", dayId: "d1", dayName: "Push", date: "2026-09-12", startedAt: 1, endedAt: 2, exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", sets: [{ id: "s1", w: 135, r: 8 }] }] } },
] as unknown as Workout[];

const today = "2026-09-14";
const base = {
  program, workouts, today, isEvening: false, gymEvent: null,
  overview: periodOverview(workouts, null, [], periodFor("7d", today)),
  findings: [], logActions: [],
  onStart: () => {}, onAdjustTime: () => {}, onOpenGym: () => {}, onOpenRecords: () => {}, onOpenFinding: () => {},
  onOpenInsights: () => {}, onOpenAllData: () => {},
  view: "health" as const, onView: () => {},
};

describe("the Health page's three doors", () => {
  it("opens Exercises in one tap", () => {
    const onOpenExercises = vi.fn();
    render(<HealthBody {...base} onOpenExercises={onOpenExercises} />);
    fireEvent.click(screen.getByRole("button", { name: /Exercises/ }));
    expect(onOpenExercises).toHaveBeenCalledTimes(1);
  });

  it("carries all three, with the count behind each", () => {
    render(<HealthBody {...base} onOpenExercises={() => {}} onOpenHistory={() => {}} />);
    expect(screen.getByText("Exercises")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    // Two exercises in the program, two program days, one logged session.
    //
    // A COUNT SAYS WHAT IT COUNTS (Dave 2026-09-16, the health polish pass:
    // "keep your order, take the better rows"). These were bare numbers under
    // a word, which reads as nothing once the eye leaves the label; they carry
    // their own noun now, through capAfterNumber like every other counted line
    // in the app, and the singular is real rather than "1 sessions".
    const counts = Array.from(document.querySelectorAll(".h-door-n")).map((n) => n.textContent);
    expect(counts).toEqual(["2 Exercises", "2 Days", "1 Session"]);
  });

  it("opens Program and History from their own doors", () => {
    const onOpenGym = vi.fn();
    const onOpenHistory = vi.fn();
    render(<HealthBody {...base} onOpenGym={onOpenGym} onOpenExercises={() => {}} onOpenHistory={onOpenHistory} />);
    const doors = document.querySelectorAll(".h-door");
    fireEvent.click(doors[1]!);
    expect(onOpenGym).toHaveBeenCalledTimes(1);
    fireEvent.click(doors[2]!);
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("shows no doors to nothing when the caller has no gym wiring", () => {
    render(<HealthBody {...base} />);
    expect(screen.queryByText("Exercises")).toBeNull();
    expect(document.querySelector(".h-doors")).toBeNull();
  });

  it("sits under the week and above the next workout", () => {
    const { container } = render(<HealthBody {...base} onOpenExercises={() => {}} onOpenHistory={() => {}} />);
    const html = container.innerHTML;
    expect(html.indexOf("h-week-card")).toBeLessThan(html.indexOf("h-doors"));
    expect(html.indexOf("h-doors")).toBeLessThan(html.indexOf("h-hero-card"));
  });
});
