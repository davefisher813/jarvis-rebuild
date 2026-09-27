// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-26: "Superset linking between exercises is broken and hard
// to use." The session reads every group off its own list, the bar's
// secondary names the partner's turn, the This Session list shows the marks,
// and the Superset chip is the one door in and out.
// ---------------------------------------------------------------------------

const a: Exercise = { id: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", restSec: 90, groupId: "g1", sets: [{ id: "a1", w: 225, r: 5 }, { id: "a2", w: 225, r: 5 }] };
const b: Exercise = { id: "b", name: "Barbell Row", kind: "weight_reps", unit: "lb", restSec: 60, groupId: "g1", sets: [{ id: "b1", w: 135, r: 8 }, { id: "b2", w: 135, r: 8 }] };
const c: Exercise = { id: "c", name: "Dumbbell Curl", kind: "weight_reps", unit: "lb", restSec: 60, sets: [{ id: "c1", w: 35, r: 10 }] };
const day = { id: "d1", name: "Pull Day", exercises: [a, b, c] };

const live = (aSets: SetEntry[], bSets: SetEntry[], idx = 0, groups?: Record<string, string>): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Pull Day", date: "2026-09-26", startedAt: 0, idx,
  exercises: [
    { exerciseId: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: aSets },
    { exerciseId: "b", name: "Barbell Row", kind: "weight_reps", unit: "lb", sets: bSets },
    { exerciseId: "c", name: "Dumbbell Curl", kind: "weight_reps", unit: "lb", sets: [] },
  ],
  ...(groups ? { groups } : {}),
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}) {
  return render(
    <SessionScreen
      live={live([], [])}
      exercise={a}
      dayExercises={[a, b, c]}
      programDay={day}
      history={[]}
      library={[]}
      onLog={() => {}}
      onSetLogged={() => {}}
      onSkip={() => {}}
      onMove={() => {}}
      onSwap={() => {}}
      onSetLoad={() => {}}
      onAddMidSession={() => {}}
      onFit={() => {}}
      onFinish={() => {}}
      onBack={() => {}}
      {...over}
    />,
  );
}

describe("a superset in the live session", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("shows the A1 / A2 marks on the This Session list, as the pair capsule", () => {
    renderScreen();
    expect(screen.getAllByText("A1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByText("Barbell Row").closest(".row")).toHaveClass("se-grp");
    expect(screen.getByText("Dumbbell Curl").closest(".row")).not.toHaveClass("se-grp");
  });

  it("offers the partner's turn as the bar's secondary, and goes there", () => {
    const onMove = vi.fn();
    renderScreen({ onMove, live: live([{ id: "x1", w: 225, r: 5 }], []) });
    const next = screen.getByRole("button", { name: "Next: A2" });
    fireEvent.click(next);
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("comes back to A1 once the partner has caught up, and walks the day once the pair is done", () => {
    const onMove = vi.fn();
    const { unmount } = renderScreen({ onMove, exercise: b, live: live([{ id: "x1", w: 225, r: 5 }], [{ id: "y1", w: 135, r: 8 }], 1) });
    fireEvent.click(screen.getByRole("button", { name: "Next: A1" }));
    expect(onMove).toHaveBeenCalledWith(0);
    unmount();
    const onMove2 = vi.fn();
    renderScreen({ onMove: onMove2, exercise: b, live: live([{ id: "x1", w: 225, r: 5 }, { id: "x2", w: 225, r: 5 }], [{ id: "y1", w: 135, r: 8 }, { id: "y2", w: 135, r: 8 }], 1) });
    fireEvent.click(screen.getByRole("button", { name: "Next Exercise" }));
    expect(onMove2).toHaveBeenCalledWith(2);
  });

  it("a pair made for today only alternates and rests after the round like a program pair", () => {
    const onFit = vi.fn();
    // c paired with a for today; a set of c leaves a behind: no rest.
    const { unmount } = renderScreen({ onFit, exercise: c, live: live([], [], 2, { a: "gt", c: "gt" }) });
    const rowOf = (name: string) => screen.getAllByText(name).map((e) => e.closest(".list-card-ruled .row")).find(Boolean);
    expect(rowOf("Dumbbell Curl")).toHaveClass("se-grp");
    fireEvent.click(screen.getByRole("button", { name: /^Log 35 Lb × 10/ }));
    expect(onFit).not.toHaveBeenCalled();
    unmount();
    // a's set closes the round: rest at the shortest rest among a (90) and c (60).
    const onFit2 = vi.fn();
    const now = Date.now();
    renderScreen({ onFit: onFit2, live: { ...live([], [], 0, { a: "gt", c: "gt" }), exercises: [
      { exerciseId: "a", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [] },
      { exerciseId: "b", name: "Barbell Row", kind: "weight_reps", unit: "lb", sets: [] },
      { exerciseId: "c", name: "Dumbbell Curl", kind: "weight_reps", unit: "lb", sets: [{ id: "z1", w: 35, r: 10 }] },
    ] } });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    const ends = (onFit2.mock.calls[0]![0] as { restEndsAt: number }).restEndsAt;
    expect(ends - now).toBeGreaterThanOrEqual(59_000);
    expect(ends - now).toBeLessThanOrEqual(61_000);
  });

  it("the Superset chip pairs an unpaired lift with the next one, asking where the pair lives", () => {
    const onGroupToday = vi.fn();
    const onGroupProgram = vi.fn();
    renderScreen({ exercise: c, live: live([], [], 2), onGroupToday, onGroupProgram });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Add$/ }));
    // c is last, so the next lift wraps to the top of the session.
    expect(screen.getByText("Superset With Bench Press")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Just This Workout" }));
    expect(onGroupToday).toHaveBeenCalledWith(["c", "a"], "Bench Press");
    expect(onGroupProgram).not.toHaveBeenCalled();
  });

  it("breaking a program pair asks today or every day; a today-only pair is simply released", () => {
    const onUngroup = vi.fn();
    const { unmount } = renderScreen({ onUngroup });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Break Up$/ }));
    expect(screen.getByText("Break Up the Superset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Every Pull Day" }));
    expect(onUngroup).toHaveBeenCalledWith("program");
    unmount();
    const onUngroup2 = vi.fn();
    renderScreen({ onUngroup: onUngroup2, exercise: c, live: live([], [], 2, { a: "gt", c: "gt" }) });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Break Up$/ }));
    expect(onUngroup2).toHaveBeenCalledWith("today");
    expect(screen.queryByText("Break Up the Superset")).toBeNull();
  });

  it("the More sheet does not repeat the superset; the chip is its one door", () => {
    renderScreen({ onGroupToday: () => {}, onUngroup: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByText(/Superset/i, { selector: ".sheet-actions button" })).toBeNull();
    expect(screen.getByRole("button", { name: "Swap Exercise" })).toBeInTheDocument();
  });
});
