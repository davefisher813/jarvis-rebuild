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
    expect(screen.getByRole("button", { name: "Exercises" })).toHaveClass("active");
    expect(screen.queryByText("This Week")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Workouts" }));
    expect(screen.getByText("This Week")).toBeInTheDocument();
    expect(screen.getByText("Last Week")).toBeInTheDocument();
    expect(screen.getByText("August")).toBeInTheDocument();
    // AMENDED 2026-09-26 (pass-off item 11): the length is the row's
    // right-hand column, a white <b> in a .row-value (a measured number
    // with no state), and the sets read "12 Sets" by the whole casing rule.
    const len = screen.getByText("47 Min");
    expect(len.tagName).toBe("B");
    expect(len.closest(".row-value")).not.toBeNull();
    expect(len.closest(".fact")).not.toHaveClass("amber");
    // AMENDED 2026-10-16 (the board, screen 4): set counts stay neutral grey; nothing lime.
    expect(screen.getByText("12 Sets")).toHaveClass("fact");
    expect(screen.getByText("12 Sets")).not.toHaveClass("lime");
    // August is folded to its summary row until tapped (the board, screen 4).
    fireEvent.click(screen.getByText("1 Workout"));
    expect(screen.getByText("1 Set")).toBeInTheDocument();
  });

  it("a session row opens that workout", () => {
    const onOpenWorkout = vi.fn();
    render(<HistoryScreen workouts={workouts} onBack={() => {}} onOpenLift={() => {}} onOpenWorkout={onOpenWorkout} />);
    fireEvent.click(screen.getByRole("button", { name: "Workouts" }));
    fireEvent.click(screen.getByRole("button", { name: /^Open Pull Day/ }));
    expect(onOpenWorkout).toHaveBeenCalledWith(workouts[1]);
  });

  it("says so when there are no sessions, and Lifts still lists Done Work only on its own segment", () => {
    render(<HistoryScreen workouts={[]} onBack={() => {}} onOpenLift={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Workouts" }));
    expect(screen.getByText("No Workouts Yet")).toBeInTheDocument();
  });
});

// DAVE, 2026-09-27, on this screen reading "No Numbers Yet" over a full
// history: "My history is all gone too". An empty list is only "nothing yet"
// once the read has answered.
describe("History before the workouts have loaded", () => {
  it("shows the loading shimmer, never No Numbers Yet", () => {
    render(<HistoryScreen workouts={[]} status="loading" onBack={() => {}} onOpenLift={() => {}} />);
    expect(screen.getByRole("status", { name: "Loading Your History" })).toBeInTheDocument();
    expect(screen.queryByText("No Numbers Yet")).toBeNull();
  });

  it("a failed load says so, says nothing was changed, and retries", () => {
    const onRetry = vi.fn();
    render(<HistoryScreen workouts={[]} status="failed" onRetry={onRetry} onBack={() => {}} onOpenLift={() => {}} />);
    expect(screen.getByText("Your History Didn't Load")).toBeInTheDocument();
    expect(screen.getByText("Nothing Was Changed · Check Your Connection")).toBeInTheDocument();
    expect(screen.queryByText("No Numbers Yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("the Sessions segment waits the same way", () => {
    render(<HistoryScreen workouts={[]} status="loading" mode="sessions" onBack={() => {}} onOpenLift={() => {}} />);
    expect(screen.queryByText("No Workouts Yet")).toBeNull();
  });

  it("once loaded, an empty history is the honest empty state", () => {
    render(<HistoryScreen workouts={[]} status="ready" onBack={() => {}} onOpenLift={() => {}} />);
    expect(screen.getByText("No Numbers Yet")).toBeInTheDocument();
  });
});

// TWO WAYS TO LOG, FROM HISTORY (Dave 2026-10-16, T): Same as Last Time and
// Log a Past Workout were reachable only inside a program day. Two taps here.
describe("History's Log action", () => {
  const ws = [workout("w1", "2026-09-12", "Push Day", 47, 12)];
  it("opens a sheet with both, and each is one more tap", () => {
    const onSame = vi.fn(), onPast = vi.fn();
    render(<HistoryScreen workouts={ws} onBack={() => {}} onOpenLift={() => {}} onSameAsLastTime={onSame} onLogPast={onPast} />);
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText("Log a Workout")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Same as Last Time" }));
    expect(onSame).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    fireEvent.click(screen.getByRole("button", { name: "Log a Past Workout" }));
    expect(onPast).toHaveBeenCalledTimes(1);
  });
  it("draws no Log action when the caller offers neither", () => {
    render(<HistoryScreen workouts={ws} onBack={() => {}} onOpenLift={() => {}} />);
    expect(screen.queryByRole("button", { name: "Log" })).toBeNull();
  });
  it("the session count is the key's white, never the done green (the colour code)", () => {
    render(<HistoryScreen workouts={ws} onBack={() => {}} onOpenLift={() => {}} />);
    expect(document.querySelector(".pill-good")).toBeNull();
    const count = screen.getByText("1", { selector: ".row-value .fact b" });
    expect(count).toBeInTheDocument();
  });
});

// THE BOARD, SCREEN 4 (Dave's approved mockup board, 2026-10-16): grey eyebrows
// for This Week and Last Week, the older month folded to a summary row, and one
// row shape: a green check, the name, a gold PR mark where a record fell, the
// date and sets in grey, the length white on the right, a chevron.
describe("History: the board's order and colours", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });
  const ws = [
    { ...workout("w1", "2026-09-12", "Pull Day", 66, 21), data: { ...workout("w1", "2026-09-12", "Pull Day", 66, 21).data, exercises: [{ exerciseId: "b", name: "Bench", kind: "weight_reps" as const, unit: "lb", sets: [{ id: "p", w: 200, r: 5 }] }] } },
    workout("w2", "2026-09-04", "Push Day", 25, 6),
    workout("w3", "2026-08-20", "Legs", 52, 1),
    workout("w4", "2026-08-12", "Legs", 40, 9),
  ];
  it("groups under eyebrows, folds the month, and each row reads the same way", () => {
    const { container } = render(<HistoryScreen workouts={ws} onBack={() => {}} onOpenLift={() => {}} onOpenWorkout={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Workouts" }));
    expect([...container.querySelectorAll(".sh2 .t")].map((e) => e.textContent)).toEqual(["This Week", "Last Week", "August"]);
    // The month is one summary row until tapped.
    expect(screen.queryByRole("button", { name: /^Open Legs/ })).toBeNull();
    fireEvent.click(screen.getByText("2 Workouts"));
    expect(screen.getAllByRole("button", { name: /^Open Legs/ })).toHaveLength(2);
    // The row: green check, name, PR (the 200 lb bench beat the 135 before it), grey date and sets, white length, chevron.
    const pull = screen.getByRole("button", { name: /^Open Pull Day/ });
    expect(pull.querySelector(".hist-done")).not.toBeNull();
    expect(pull.querySelector(".se-pr")).toHaveTextContent("PR");
    expect([...pull.querySelectorAll(".facts .fact")].map((f) => f.textContent)).toEqual(["Sep 12", "1 Set"]);
    expect(pull.querySelector(".facts .fact.lime")).toBeNull();
    expect(pull.querySelector(".row-value .fact b")).toHaveTextContent("1h 6m");
    expect(pull.querySelector(".chev")).not.toBeNull();
    // A workout with no record carries no mark, and nothing on the list is lime.
    expect(screen.getByRole("button", { name: /^Open Push Day/ }).querySelector(".se-pr")).toBeNull();
    expect(container.querySelector(".fact.lime, .pill-good")).toBeNull();
  });
});
