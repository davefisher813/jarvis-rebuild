// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-26, the pass-off's top item: "Bottom action buttons do not
// update when numbers change. They show the wrong logged weight." And:
// "Logging renders inconsistently. Different styles show up for logging
// depending on what's clicked. Needs one single clean logging flow."
//
// The fields, the red button's label and the write read ONE entry now
// (nextSet.ts withDraft). Every test here failed on the code before it.
// ---------------------------------------------------------------------------

const exercise: Exercise = {
  id: "e1", name: "Lateral Shoulder Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat",
  sets: [{ id: "p1", w: 20, r: 10 }, { id: "p2", w: 20, r: 10 }, { id: "p3", w: 20, r: 10 }],
};

const workout = (sets: SetEntry[]): Workout => ({
  id: "w1",
  data: { programId: "p", dayId: "d1", dayName: "Auxiliary Day", date: "2026-09-19", startedAt: 1, endedAt: 2,
    exercises: [{ exerciseId: "e1", name: "Lateral Shoulder Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat", sets }] },
});

const live = (logged: SetEntry[]): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Auxiliary Day", date: "2026-09-26", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Lateral Shoulder Raise", kind: "weight_reps", unit: "lb", exerciseKey: "k-lat", sets: logged }],
});

function renderScreen(over: Partial<Parameters<typeof SessionScreen>[0]> = {}) {
  return render(
    <SessionScreen
      live={live([])}
      exercise={exercise}
      dayExercises={[exercise]}
      programDay={{ id: "d1", name: "Auxiliary Day", exercises: [exercise] }}
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

const cta = () => screen.getByRole("button", { name: /^Log / });

describe("the red button names exactly what the fields hold", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("never layers the plan under the fields: reps alone last time is reps alone now", () => {
    // Plan 20 lb x 10; last session logged 10 reps with no weight.
    renderScreen({ history: [workout([{ id: "l1", r: 10 }])] });
    expect(screen.getByLabelText("Set 1 weight")).toHaveValue(null);
    expect(cta()).toHaveTextContent("Log 10 Reps");
  });

  it("follows every keystroke, in the same frame", () => {
    renderScreen();
    expect(cta()).toHaveTextContent("Log 20 Lb × 10");
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "25" } });
    expect(cta()).toHaveTextContent("Log 25 Lb × 10");
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "8" } });
    expect(cta()).toHaveTextContent("Log 25 Lb × 8");
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "" } });
    expect(cta(), "an emptied weight comes off the label").toHaveTextContent("Log 8 Reps");
  });

  it("writes the numbers it names, with one receipt and an Undo", () => {
    const onLog = vi.fn();
    renderScreen({ onLog });
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "25" } });
    fireEvent.click(cta());
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 25, r: 10 });
    expect(vi.mocked(showToast)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.calls[0]![0]).toMatchObject({ message: "Logged 25 Lb × 10", actionLabel: "Undo" });
  });

  it("the set before feeds the Now row AND the button once a set is logged", () => {
    renderScreen({ live: live([{ id: "s1", w: 22.5, r: 9 }]) });
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue(22.5);
    expect(screen.getByLabelText("Set 2 reps")).toHaveValue(9);
    expect(cta()).toHaveTextContent("Log 22.5 Lb × 9");
    // And the Up Next row carries the same numbers, so it never changes
    // when it becomes Now.
    expect(screen.getByText("Up Next · Set 3").parentElement!.parentElement).toHaveTextContent("22.5 Lb × 9");
  });

  it("correcting the logged set moves the fields and the button together", () => {
    const onSetLogged = vi.fn();
    const { rerender } = renderScreen({ live: live([{ id: "s1", w: 20, r: 10 }]), onSetLogged });
    fireEvent.click(screen.getByRole("button", { name: /^Set 1 · Done, / }));
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "19" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSetLogged.mock.calls[0]![0]).toMatchObject([{ id: "s1", w: 19, r: 10 }]);
    // The parent writes the strip back; both readers move to 19.
    rerender(
      <SessionScreen live={live([{ id: "s1", w: 19, r: 10 }])} exercise={exercise} dayExercises={[exercise]}
        programDay={{ id: "d1", name: "Auxiliary Day", exercises: [exercise] }} history={[]} library={[]}
        onLog={() => {}} onSetLogged={onSetLogged} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
        onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue(19);
    expect(cta()).toHaveTextContent("Log 19 Lb × 10");
  });

  it("Match puts last time's numbers in the fields and hides once they are there", () => {
    // Set 2: the set before says 20 x 10; last time's set 2 was 17.5 x 12.
    renderScreen({ live: live([{ id: "s1", w: 20, r: 10 }]), history: [workout([{ id: "l1", w: 17.5, r: 12 }, { id: "l2", w: 17.5, r: 12 }])] });
    const match = screen.getByRole("button", { name: /same as last time$/ });
    fireEvent.click(match);
    expect(screen.getByLabelText("Set 2 weight")).toHaveValue(17.5);
    expect(cta()).toHaveTextContent("Log 17.5 Lb × 12");
    expect(screen.queryByRole("button", { name: /same as last time$/ }), "the verb hides once the fields match").toBeNull();
  });

  it("only the red button logs: no tick on the row, and the row's body writes nothing", () => {
    const onLog = vi.fn();
    renderScreen({ onLog });
    expect(screen.queryByLabelText("Log set 1")).toBeNull();
    fireEvent.click(screen.getByText("Now · Set 1"));
    expect(onLog).not.toHaveBeenCalled();
  });

  it("the load calculator opens at the weight in the fields, not the plan's", () => {
    const styled = { ...exercise, equipment: "barbell" as const };
    renderScreen({ exercise: styled });
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Plate Calculator" }));
    expect(document.body.textContent).toContain("95");
  });

  it("after the plan, Add a Set opens one more Now row prefilled with the set before", () => {
    const onLog = vi.fn();
    renderScreen({ onLog, live: live([{ id: "s1", w: 20, r: 10 }, { id: "s2", w: 20, r: 10 }, { id: "s3", w: 22.5, r: 8 }]) });
    expect(screen.queryByLabelText(/weight$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a Set" }));
    expect(screen.getByLabelText("Set 4 weight")).toHaveValue(22.5);
    expect(cta()).toHaveTextContent("Log 22.5 Lb × 8");
    fireEvent.click(cta());
    expect(onLog.mock.calls[0]![0]).toMatchObject({ w: 22.5, r: 8 });
  });

  it("Skip This Exercise is offered only while nothing is logged", () => {
    const { unmount } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "Skip This Exercise" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    unmount();
    renderScreen({ live: live([{ id: "s1", w: 20, r: 10 }]) });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("button", { name: "Skip This Exercise" })).toBeNull();
  });
});
