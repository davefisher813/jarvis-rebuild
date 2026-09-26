// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HistoryScreen from "./HistoryScreen";
import type { Workout } from "./types";

// Health Push E, H-32 (2026-09-12): Lifts / Sessions on History.
const T0 = new Date("2026-09-13T12:00:00").getTime();
const workout = (id: string, date: string, dayName: string, mins: number, sets: number): Workout => ({
  id,
  data: {
    programId: "p", dayId: "d", dayName, date, startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + mins * 60_000,
    exercises: [{ exerciseId: "b", name: "Bench", kind: "weight_reps", unit: "lb", sets: Array.from({ length: sets }, (_, i) => ({ id: "s" + i, w: 135, r: 5 })) }],
  },
});

describe("HistoryScreen: Lifts / Sessions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  const workouts = [
    workout("w1", "2026-09-12", "Push Day", 47, 12),
    workout("w2", "2026-09-04", "Pull Day", 38, 9),
    workout("w3", "2026-08-20", "Legs", 52, 1),
  ];

  it("opens on Lifts, and Sessions groups the workouts by week with three facts each", () => {
    render(<HistoryScreen workouts={workouts} onBack={() => {}} onOpenLift={() => {}} onOpenWorkout={() => {}} />);
    expect(screen.getByRole("button", { name: "Lifts" })).toHaveClass("active");
    expect(screen.queryByText("This Week")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByText("This Week")).toBeInTheDocument();
    expect(screen.getByText("Last Week")).toBeInTheDocument();
    expect(screen.getByText("August")).toBeInTheDocument();
    expect(screen.getByText("47 Min")).toHaveClass("fact");
    expect(screen.getByText("47 Min")).not.toHaveClass("amber");
    expect(screen.getByText("12 sets")).toHaveClass("fact", "lime");
    expect(screen.getByText("1 set")).toBeInTheDocument();
  });

  it("a session row opens that workout", () => {
    const onOpenWorkout = vi.fn();
    render(<HistoryScreen workouts={workouts} onBack={() => {}} onOpenLift={() => {}} onOpenWorkout={onOpenWorkout} />);
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    fireEvent.click(screen.getByRole("button", { name: /^Open Pull Day/ }));
    expect(onOpenWorkout).toHaveBeenCalledWith(workouts[1]);
  });

  it("says so when there are no sessions, and Lifts still lists Done Work only on its own segment", () => {
    render(<HistoryScreen workouts={[]} onBack={() => {}} onOpenLift={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByText("No Sessions Yet")).toBeInTheDocument();
  });
});
