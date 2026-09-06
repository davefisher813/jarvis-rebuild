// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
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
    <SessionScreen
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

  it("says what was logged, in the exercise's own units", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Log 225 lb × 5" }));
    expect(vi.mocked(showToast).mock.calls[0]![0].message).toBe("Logged 225 lb × 5");
  });

  it("offers an Undo that puts the strip back exactly as it was before the tap", () => {
    const onSetLogged = vi.fn();
    renderScreen({ onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: "Log 225 lb × 5" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Log 225 lb × 5" }));
    expect(vi.mocked(showToast).mock.calls[0]![0].onAction).toBeTypeOf("function");
    vi.mocked(showToast).mock.calls[0]![0].onAction!();
    expect(onSetLogged.mock.calls[0]![1]).toBe(0);
  });
});
