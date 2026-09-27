// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import { readGymSettings, writeGymSettings } from "./settings";
import type { Exercise, Workout } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));

// DAVE, 2026-09-27: "autofill while logging during workouts should default to
// the week prior when there's nothing there and then to the prior set once you
// are working out." Show Last is a switch for the chips; it must not decide
// what the fields open at.
const bench: Exercise = { id: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "a1", w: 135, r: 10 }, { id: "a2", w: 135, r: 10 }] };
const lastWeek: Workout = { id: "w1", data: { programId: "p", dayId: "d1", dayName: "Push Day", date: "2026-09-20", startedAt: 0, endedAt: 0,
  exercises: [{ exerciseId: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "s1", w: 225, r: 5 }, { id: "s2", w: 225, r: 4 }] }] } };
const live = (sets: LiveSession["exercises"][number]["sets"]): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push Day", date: "2026-09-27", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", sets }],
});
const renderAt = (l: LiveSession) => render(
  <SessionScreen live={l} exercise={bench} dayExercises={[bench]} programDay={{ id: "d1", name: "Push Day", exercises: [bench] }}
    history={[lastWeek]} library={[]} onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}}
    onSwap={() => {}} onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
);

describe("the prefill", () => {
  beforeEach(() => { localStorage.clear(); });

  it("opens the first set at last week's numbers, not the plan's", () => {
    renderAt(live([]));
    expect(screen.getByRole("button", { name: /^Log 225 Lb × 5/ })).toBeInTheDocument();
  });

  it("does so with Show Last switched off", () => {
    writeGymSettings({ ...readGymSettings(), showLast: false });
    renderAt(live([]));
    expect(screen.getByRole("button", { name: /^Log 225 Lb × 5/ })).toBeInTheDocument();
  });

  it("then opens every later set at the set before", () => {
    renderAt(live([{ id: "x1", w: 230, r: 6 }]));
    expect(screen.getByRole("button", { name: /^Log 230 Lb × 6/ })).toBeInTheDocument();
  });
});
