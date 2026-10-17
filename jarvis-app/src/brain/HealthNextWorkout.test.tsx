// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HealthBody from "./HealthBody";
import type { Program, Workout } from "../gym/types";
import { periodFor, periodOverview } from "../insights/analytics";

// A PLAIN COUNT IS NEVER LIME (Dave 2026-10-05, the ship-blocker review: the Next Workout's exercise count was lime in
// dark and grey in light). Colour is for meaning; a number with no state is the one white, the same in both themes.
afterEach(cleanup);

const program = {
  id: "p1", entityType: "program",
  data: { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [
    { id: "d1", name: "Push", exercises: [
      { id: "e1", name: "Bench Press", kind: "weight_reps", sets: [] },
      { id: "e2", name: "Overhead Press", kind: "weight_reps", sets: [] },
    ] },
  ] }] },
} as unknown as Program;
const workouts: Workout[] = [];
const today = "2026-09-14";
const base = {
  program, workouts, today, isEvening: false, gymEvent: null,
  overview: periodOverview(workouts, null, [], periodFor("7d", today)),
  findings: [], logActions: [],
  onStart: () => {}, onAdjustTime: () => {}, onOpenGym: () => {}, onOpenRecords: () => {}, onOpenFinding: () => {},
  view: "health" as const, onView: () => {},
};

// AMENDED 2026-10-17 (Dave: the next day IS the red button): the count rides the button's facts in the button's own white.
describe("the Next Workout's exercise count", () => {
  it("is a plain fact inside the Start button, never the lime one", () => {
    const { container } = render(<HealthBody {...base} />);
    const fact = [...container.querySelectorAll(".h-hero-go .facts .fact")].find((f) => /Exercises/.test(f.textContent ?? ""))!;
    expect(fact.textContent).toBe("2 Exercises");
    expect(fact).not.toHaveClass("lime");
    expect(fact.querySelector("b")).toBeNull();
  });

  it("is the same plain fact on the sheet the Change Workout capsule opens", () => {
    const { container } = render(<HealthBody {...base} />);
    fireEvent.click([...container.querySelectorAll(".h-hero-cta .day-acts .btn")].find((b) => b.textContent === "Change Workout")!);
    const facts = [...document.querySelectorAll(".sheet-scrim .facts .fact")];
    const fact = facts.find((f) => /Exercises/.test(f.textContent ?? ""))!;
    expect(fact).toBeTruthy();
    expect(fact).not.toHaveClass("lime");
  });
});
