// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionScreen from "./SessionScreen";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));
import { showToast } from "../shared/toast";

// GYM-F-24 (2026-09-05): in the live session the strip writes straight through
// to storage, so one tap on the swipe-revealed delete took the 275 x 5 that had
// just happened, with no toast and no undo, while every other delete in the app
// offers one.

const logged: SetEntry[] = [
  { id: "s1", w: 275, r: 5 },
  { id: "s2", w: 275, r: 5 },
];

const exercise: Exercise = { id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "p1", w: 275, r: 5 }] };

const live = (): LiveSession => ({
  programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-05", startedAt: 0, idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: logged }],
});

function renderScreen(onSetLogged: (s: SetEntry[]) => void) {
  return render(
    <SessionScreen
      live={live()}
      exercise={exercise}
      dayExercises={[exercise]}
      programDay={{ id: "d1", name: "Push", exercises: [exercise] }}
      history={[]}
      library={[]}
      onLog={() => {}}
      onSetLogged={onSetLogged}
      onSkip={() => {}}
      onMove={() => {}}
      onSwap={() => {}}
      onAddMidSession={() => {}}
      onFit={() => {}}
      onFinish={() => {}}
      onBack={() => {}}
    />,
  );
}

describe("deleting a logged set in the live session", () => {
  beforeEach(() => { vi.mocked(showToast).mockClear(); });

  it("offers an Undo that puts the whole strip back exactly as it was", () => {
    const onSetLogged = vi.fn();
    renderScreen(onSetLogged);
    fireEvent.click(screen.getByRole("button", { name: "Delete set 2" }));
    expect(onSetLogged).toHaveBeenCalledWith([logged[0]]);

    const toast = vi.mocked(showToast).mock.calls[0]![0];
    expect(toast.message).toBe("Set Deleted");
    expect(toast.actionLabel).toBe("Undo");
    toast.onAction!();
    // UP-ATH-04 (2026-09-06): the restore names its exercise now, so an Undo
    // taken after the session has moved on still lands on this strip.
    expect(onSetLogged).toHaveBeenLastCalledWith(logged, 0);
  });

  // AMENDED 2026-09-26 (workout logging): a Done row opens the Set sheet,
  // the same two fields the Now row has; Save writes the edit.
  it("an edit is not a delete: correcting a set offers no undo toast", () => {
    const onSetLogged = vi.fn();
    renderScreen(onSetLogged);
    // H-17 / R9 (2026-09-12): a logged chip's kicker says its state.
    fireEvent.click(screen.getByRole("button", { name: /^Set 1 · Done, / }));
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSetLogged).toHaveBeenCalledTimes(1);
    expect(onSetLogged.mock.calls[0]![0]).toMatchObject([{ id: "s1", w: 275, r: 6 }, { id: "s2" }]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("the Set sheet's own Delete takes the standard receipt with Undo", () => {
    const onSetLogged = vi.fn();
    renderScreen(onSetLogged);
    fireEvent.click(screen.getByRole("button", { name: /^Set 2 · Done, / }));
    fireEvent.click(screen.getByRole("button", { name: "Delete This Set" }));
    expect(onSetLogged).toHaveBeenCalledWith([logged[0]]);
    expect(vi.mocked(showToast).mock.calls[0]![0]).toMatchObject({ message: "Set Deleted", actionLabel: "Undo" });
  });
});
