// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn() }));
import { showToast } from "../shared/toast";

// Part 3 wave 2 (2026-09-13): rest after the round, no phantom turns, and a
// drop segment that counts in tonnage and nowhere else.
const a: Exercise = { id: "a", name: "Bench", kind: "weight_reps", unit: "lb", restSec: 90, roundRestSec: 120, groupId: "g1", sets: [{ id: "a1", w: 225, r: 5 }, { id: "a2", w: 225, r: 5 }, { id: "a3", w: 225, r: 5 }] };
const b: Exercise = { id: "b", name: "Row", kind: "weight_reps", unit: "lb", restSec: 90, groupId: "g1", sets: [{ id: "b1", w: 135, r: 8 }, { id: "b2", w: 135, r: 8 }] };
const day = { id: "d1", name: "Push", exercises: [a, b] };

const live = (aSets: SetEntry[], bSets: SetEntry[], idx = 0): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-13", startedAt: 0, idx,
  exercises: [
    { exerciseId: "a", name: "Bench", kind: "weight_reps", unit: "lb", sets: aSets },
    { exerciseId: "b", name: "Row", kind: "weight_reps", unit: "lb", sets: bSets },
  ],
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}) {
  return render(
    <SessionScreen
      live={live([], [])}
      exercise={a}
      dayExercises={[a, b]}
      programDay={day}
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

describe("rest after the round", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("a set that leaves the partner behind starts no rest; the round's end starts the round rest", () => {
    const onFit = vi.fn();
    // Bench has logged nothing, Row nothing: Bench set 1 leaves Row behind.
    const { unmount } = renderScreen({ onFit });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onFit).not.toHaveBeenCalled();
    unmount();
    // Bench 1 and Row 1 logged; Bench set 2 still leaves Row (1) behind.
    const onFit2 = vi.fn();
    const { unmount: u2 } = renderScreen({ onFit: onFit2, live: live([{ id: "x1", w: 225, r: 5 }], [{ id: "y1", w: 135, r: 8 }]) });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onFit2).not.toHaveBeenCalled();
    u2();
    // Row has both its sets; Bench's third completes the last round: rest.
    const onFit3 = vi.fn();
    const now = Date.now();
    renderScreen({ onFit: onFit3, live: live([{ id: "x1", w: 225, r: 5 }, { id: "x2", w: 225, r: 5 }], [{ id: "y1", w: 135, r: 8 }, { id: "y2", w: 135, r: 8 }]) });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onFit3).toHaveBeenCalledTimes(1);
    const ends = (onFit3.mock.calls[0]![0] as { restEndsAt: number }).restEndsAt;
    expect(ends - now).toBeGreaterThanOrEqual(119_000);
    expect(ends - now).toBeLessThanOrEqual(121_000);
  });

  // AMENDED 2026-09-26 (workout logging, Dave: every superset rests after
  // the round, at the shortest rest among its lifts unless the program set
  // one). It used to rest after every set when no round rest was stated.
  it("with no round rest on the group, the round still rests, at the shortest rest among the members", () => {
    const onFit = vi.fn();
    const plainA = { ...a, roundRestSec: undefined, restSec: 120 };
    // Bench leaves Row behind: no rest.
    const { unmount } = renderScreen({ onFit, exercise: plainA, dayExercises: [plainA, b], programDay: { ...day, exercises: [plainA, b] } });
    fireEvent.click(screen.getByRole("button", { name: /^Log 225 Lb × 5/ }));
    expect(onFit).not.toHaveBeenCalled();
    unmount();
    // Row's set closes the round: rest at the shortest stated rest, Row's 90.
    const onFit2 = vi.fn();
    const now = Date.now();
    renderScreen({ onFit: onFit2, exercise: b, dayExercises: [plainA, b], programDay: { ...day, exercises: [plainA, b] }, live: live([{ id: "x1", w: 225, r: 5 }], [], 1) });
    fireEvent.click(screen.getByRole("button", { name: /^Log 135 Lb × 8/ }));
    expect(onFit2).toHaveBeenCalledTimes(1);
    const ends = (onFit2.mock.calls[0]![0] as { restEndsAt: number }).restEndsAt;
    expect(ends - now).toBeGreaterThanOrEqual(89_000);
    expect(ends - now).toBeLessThanOrEqual(91_000);
  });
});

describe("Log a Drop", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("is offered after a working set, logs a drop at that set's numbers, starts no rest, and offers Undo", () => {
    const onLog = vi.fn();
    const onFit = vi.fn();
    renderScreen({ onLog, onFit, live: live([{ id: "x1", w: 225, r: 5 }], []) });
    // AMENDED 2026-09-26 (workout logging): it is a line in the More sheet.
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Log a Drop" }));
    expect(onLog).toHaveBeenCalledTimes(1);
    const e = onLog.mock.calls[0]![0] as SetEntry;
    expect(e).toMatchObject({ w: 225, r: 5, drop: true });
    expect(e.id).not.toBe("x1");
    expect(onFit).not.toHaveBeenCalled();
    expect(vi.mocked(showToast).mock.calls[0]![0]).toMatchObject({ message: "Logged a Drop · Tap It to Set the Weight", actionLabel: "Undo" });
  });

  it("is not offered before any working set", () => {
    renderScreen({ live: live([], []) });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("button", { name: "Log a Drop" })).toBeNull();
  });

  it("a logged drop reads as Drop on the strip and never takes a set number", () => {
    renderScreen({ live: live([{ id: "x1", w: 225, r: 5 }, { id: "x2", w: 185, r: 8, drop: true }], []) });
    expect(screen.getByText("Drop · Done")).toBeInTheDocument();
    expect(screen.queryByText("Set 2 · Done")).toBeNull();
  });
});
