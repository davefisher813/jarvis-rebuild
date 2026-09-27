// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    // AMENDED 2026-09-27: the marks also ride the switcher under the title.
    expect(screen.getAllByText("A1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("A2").length).toBeGreaterThanOrEqual(1);
    const rowOf = (name: string) => screen.getAllByText(name).map((e) => e.closest(".list-card-ruled .row")).find(Boolean);
    expect(rowOf("Barbell Row")).toHaveClass("se-grp");
    expect(rowOf("Dumbbell Curl")).not.toHaveClass("se-grp");
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

  // AMENDED 2026-09-27 (Dave: "I need to be able to merge 2-3 exercises
  // together seamlessly for supersets while logging my workouts. There is no
  // way to do that. It needs to be easy and obvious"). The chip no longer
  // pairs with whatever comes next: it opens a picker over every lift in the
  // session, this one already picked, and two or three picks make the group.
  const sheet = () => within(document.querySelector(".sheet-scrim") as HTMLElement);

  it("the Superset chip opens a picker with this lift already picked, and asks where the group lives", () => {
    const onGroupToday = vi.fn();
    const onGroupProgram = vi.fn();
    renderScreen({ exercise: c, live: live([], [], 2), onGroupToday, onGroupProgram });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Add$/ }));
    expect(sheet().getByText("Superset")).toBeInTheDocument();
    // One pick is not a superset: the button says what is missing.
    expect(sheet().getByRole("button", { name: "Pick at Least Two" })).toBeDisabled();
    fireEvent.click(sheet().getByText("Bench Press"));
    fireEvent.click(sheet().getByRole("button", { name: "Superset These Two" }));
    // Both are on the program day, so it asks.
    fireEvent.click(screen.getByRole("button", { name: "Just This Workout" }));
    expect(onGroupToday).toHaveBeenCalledWith(["c", "a"]);
    expect(onGroupProgram).not.toHaveBeenCalled();
  });

  it("the This Session head carries the same door, and three picks make a tri-set", () => {
    const onGroupToday = vi.fn();
    const onGroupProgram = vi.fn();
    renderScreen({ exercise: c, live: live([], [], 2), onGroupToday, onGroupProgram });
    fireEvent.click(screen.getByRole("button", { name: "Superset" }));
    fireEvent.click(sheet().getByText("Bench Press"));
    fireEvent.click(sheet().getByText("Barbell Row"));
    fireEvent.click(sheet().getByRole("button", { name: "Superset These 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Every Pull Day" }));
    expect(onGroupProgram).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("a lift the day does not have groups for today without the question", () => {
    const onGroupToday = vi.fn();
    renderScreen({ exercise: c, onGroupToday, onGroupProgram: vi.fn(), dayExercises: [a, b], live: live([], [], 2) });
    fireEvent.click(screen.getByRole("button", { name: "Superset" }));
    fireEvent.click(sheet().getByText("Bench Press"));
    fireEvent.click(sheet().getByRole("button", { name: "Superset These Two" }));
    expect(onGroupToday).toHaveBeenCalledWith(["c", "a"]);
    expect(screen.queryByRole("button", { name: "Just This Workout" })).toBeNull();
  });

  it("breaking a program pair asks today or every day; a today-only pair is simply released", () => {
    const onUngroup = vi.fn();
    const { unmount } = renderScreen({ onUngroup, onGroupToday: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Edit$/ }));
    fireEvent.click(sheet().getByRole("button", { name: "Break Up the Superset" }));
    expect(screen.getByText("Break Up the Superset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Every Pull Day" }));
    expect(onUngroup).toHaveBeenCalledWith("program");
    unmount();
    const onUngroup2 = vi.fn();
    renderScreen({ onUngroup: onUngroup2, onGroupToday: vi.fn(), exercise: c, live: live([], [], 2, { a: "gt", c: "gt" }) });
    fireEvent.click(screen.getByRole("button", { name: /^Superset\s*Edit$/ }));
    fireEvent.click(sheet().getByRole("button", { name: "Break Up the Superset" }));
    expect(onUngroup2).toHaveBeenCalledWith("today");
  });

  it("goes to the next lift in the superset on its own when a set lands, and Undo comes back", () => {
    const onMove = vi.fn();
    const onSetLogged = vi.fn();
    renderScreen({ onMove, onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onMove).toHaveBeenCalledWith(1);
    const toast = vi.mocked(showToast).mock.calls.at(-1)![0] as { message: string; onAction: () => void };
    expect(toast.message).toMatch(/Now Barbell Row$/);
    toast.onAction();
    expect(onSetLogged).toHaveBeenCalledWith([], 0);
    expect(onMove).toHaveBeenLastCalledWith(0);
  });

  it("stays put when the partner has nothing left, and moves nowhere outside a superset", () => {
    const onMove = vi.fn();
    const { unmount } = renderScreen({ onMove, live: live([{ id: "x1", w: 225, r: 5 }], [{ id: "y1", w: 135, r: 8 }, { id: "y2", w: 135, r: 8 }]) });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onMove).not.toHaveBeenCalled();
    unmount();
    const onMove2 = vi.fn();
    renderScreen({ onMove: onMove2, exercise: c, live: live([], [], 2) });
    fireEvent.click(screen.getByRole("button", { name: /^Log 35 Lb × 10/ }));
    expect(onMove2).not.toHaveBeenCalled();
  });

  it("the switcher under the title goes to any member of the superset in one tap", () => {
    const onMove = vi.fn();
    renderScreen({ onMove });
    const turns = within(screen.getByRole("group", { name: "Superset" }));
    expect(turns.getByRole("button", { name: /A1\s*Bench Press/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(turns.getByRole("button", { name: /A2\s*Barbell Row/ }));
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("the More sheet does not repeat the superset; the chip and the list head are its doors", () => {
    renderScreen({ onGroupToday: () => {}, onUngroup: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByText(/Superset/i, { selector: ".sheet-actions button" })).toBeNull();
    expect(screen.getByRole("button", { name: "Swap Exercise" })).toBeInTheDocument();
  });
});

describe("cancelling a workout", () => {
  it("the foot of This Session cancels, after asking, and Keep Going changes nothing", () => {
    const onCancel = vi.fn();
    renderScreen({ onCancel, live: live([{ id: "x1", w: 225, r: 5 }], []) });
    fireEvent.click(screen.getByRole("button", { name: "Cancel Workout" }));
    expect(screen.getByText("Cancel Pull Day? 1 Set Will Not Be Saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep Going" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Workout" }));
    const confirm = within(document.querySelector(".sheet-scrim") as HTMLElement).getByRole("button", { name: "Cancel Workout" });
    fireEvent.click(confirm);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("is absent where the caller cannot cancel", () => {
    renderScreen();
    expect(screen.queryByRole("button", { name: "Cancel Workout" })).toBeNull();
  });
});
