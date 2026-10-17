// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// UP-ATH-04 (2026-09-06): Log Set wrote straight through with no receipt at
// all, so a fat-fingered tap on a gym floor cost a swipe and a hunt through
// the strip. Every other write in the app that can be wrong offers an Undo.

const logged: SetEntry[] = [{ id: "s1", w: 225, r: 5 }];

const exercise: Exercise = {
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb",
  sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }],
};

const live = (): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-06", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: logged }],
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}) {
  return render(
    <SessionScreen onAdopt={() => {}}
      live={live()}
      exercise={exercise}
      dayExercises={[exercise]}
      programDay={{ id: "d1", name: "Push", exercises: [exercise] }}
      history={[]}
      library={[]}
      onLog={() => {}}
      onSetLogged={() => {}}
      onSkip={() => {}}
      onMove={() => {}}
      onSwap={() => {}}
      onAddMidSession={() => {}}
      onFit={() => {}}
      onFinish={() => {}}
      onBack={() => {}}
      {...over}
    />,
  );
}

describe("logging a set in the live session", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  // AMENDED 2026-09-26 (workout logging): the button and the receipt are
  // cased by the whole rule, "225 Lb × 5".
  it("says what was logged, in the exercise's own units", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Log 225 Lb × 5" }));
    expect(vi.mocked(showToast).mock.calls[0]![0].message).toBe("Logged 225 Lb × 5");
  });

  it("offers an Undo that puts the strip back exactly as it was before the tap", () => {
    const onSetLogged = vi.fn();
    renderScreen({ onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: "Log 225 Lb × 5" }));
    const toast = vi.mocked(showToast).mock.calls[0]![0];
    expect(toast.actionLabel).toBe("Undo");
    toast.onAction!();
    expect(onSetLogged).toHaveBeenCalledWith(logged, 0);
    // A snapshot, not a toggle: tapping it twice, or late, lands on the same
    // answer rather than removing a second set (SHARED-F-03).
    toast.onAction!();
    expect(onSetLogged).toHaveBeenLastCalledWith(logged, 0);
  });

  it("the Undo names the exercise it belongs to, so a late tap cannot land on another one", () => {
    const onSetLogged = vi.fn();
    renderScreen({ onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: "Log 225 Lb × 5" }));
    expect(vi.mocked(showToast).mock.calls[0]![0].onAction).toBeTypeOf("function");
    vi.mocked(showToast).mock.calls[0]![0].onAction!();
    expect(onSetLogged.mock.calls[0]![1]).toBe(0);
  });
});

// ONE RECEIPT, ONE UNDO, BOTH WRITES (2026-10-17, Logging Standard rule 5).
// Logging the first set at the suggested numbers also moves the program's
// plan. That move used to announce itself on a second toast with no Undo, and
// the set's Undo put back the set alone, so the plan stayed moved. The accept
// hands back the restore; the one receipt says the plan moved and its Undo
// reverts both.
describe("the accept rides the set's receipt", () => {
  const plan: Exercise = {
    id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "k-bench", equipment: "barbell",
    sets: [{ id: "p1", w: 275, r: 6 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }],
  };
  const allTop: Workout = { id: "w1", data: { programId: "p", dayId: "d1", dayName: "Push", date: "2026-10-10", startedAt: 1, endedAt: 2,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "k-bench", sets: [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }] }] } };
  const fresh = (): LiveSession => ({
    programId: "p", dayId: "d1", dayName: "Push", date: "2026-10-17", startedAt: 0, idx: 0,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "k-bench", sets: [] }],
  });
  // Prefill (Dave, 2026-10-17): the step is already in the fields, and
  // logging it untouched is the accept.
  const logStep = () => {
    fireEvent.click(screen.getByRole("button", { name: "Log 280 Lb × 6" }));
    return vi.mocked(showToast).mock.calls[0]![0];
  };

  beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

  it("the receipt says the plan moved, and its one Undo puts back the set and the plan", () => {
    const onSetLogged = vi.fn();
    const restorePlan = vi.fn();
    const onAcceptSuggestion = vi.fn(() => restorePlan);
    renderScreen({ live: fresh(), exercise: plan, dayExercises: [plan], programDay: { id: "d1", name: "Push", exercises: [plan] }, history: [allTop], onSetLogged, onAcceptSuggestion });
    const toast = logStep();
    expect(onAcceptSuggestion).toHaveBeenCalledTimes(1);
    expect(toast.message).toBe("Logged 280 Lb × 6 · Plan Moved");
    expect(toast.actionLabel).toBe("Undo");
    // No second receipt for the move: one action, one toast.
    expect(vi.mocked(showToast)).toHaveBeenCalledTimes(1);
    expect(restorePlan).not.toHaveBeenCalled();
    toast.onAction!();
    expect(onSetLogged).toHaveBeenCalledWith([], 0);
    expect(restorePlan).toHaveBeenCalledTimes(1);
  });

  it("when nothing moved (the lift is not in this day's plan) the receipt says only what was logged", () => {
    const onSetLogged = vi.fn();
    const onAcceptSuggestion = vi.fn(() => null);
    renderScreen({ live: fresh(), exercise: plan, dayExercises: [plan], programDay: { id: "d1", name: "Push", exercises: [plan] }, history: [allTop], onSetLogged, onAcceptSuggestion });
    const toast = logStep();
    expect(toast.message).toBe("Logged 280 Lb × 6");
    toast.onAction!();
    expect(onSetLogged).toHaveBeenCalledWith([], 0);
  });
});
