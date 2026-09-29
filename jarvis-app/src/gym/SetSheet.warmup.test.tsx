// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetSheet from "./SetSheet";
import SessionScreen from "./SessionScreen";
import { fieldsFor } from "./measures";
import { scoreOf, setVolume } from "./measures";
import type { Exercise, SetEntry } from "./types";
import type { LiveSession } from "./liveSession";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: vi.fn(), subscribeToast: vi.fn() }));

// THE SET SHEET IS THE ONE PLACE A LOGGED SET CHANGES KIND (2026-09-29, Dave:
// "I should also be EASILY able to mark sets as warm ups and vice versa").

const sheet = (entry: SetEntry, onSave = vi.fn()) => {
  render(<SetSheet title="Set 1" kind="weight_reps" fields={fieldsFor("weight_reps", { unit: "lb" })} entry={entry} moveTracking
    onSave={onSave} onSkip={() => {}} onDuplicate={() => {}} onDelete={() => {}} onCancel={() => {}} />);
  return onSave;
};
const toggle = () => screen.getByRole("switch", { name: "Warm-up set" });

describe("the Warm-Up Set switch", () => {
  it("is the first row of the sheet, off for a working set", () => {
    sheet({ id: "s1", w: 225, r: 5 });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Warm-Up Set")).toBeInTheDocument();
  });

  it("turns a working set into a warm-up on Save, keeping weight and reps", () => {
    const onSave = sheet({ id: "s1", w: 225, r: 5, moved: "grind" });
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = onSave.mock.calls[0]![0];
    expect(patch).toMatchObject({ warmup: true, w: 225, r: 5 });
    // A warm-up carries no How Did It Move mark (D6).
    expect(patch.moved).toBeUndefined();
  });

  it("turns a warm-up back into a working set, again keeping the numbers", () => {
    const onSave = sheet({ id: "w1", w: 135, r: 8, warmup: true });
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = onSave.mock.calls[0]![0];
    expect(patch.warmup).toBeUndefined();
    expect(patch).toMatchObject({ w: 135, r: 8 });
    expect("warmup" in patch).toBe(true); // the key is present, so the merge clears the flag
  });

  it("offers How Did It Move only while the set is work", () => {
    sheet({ id: "s1", w: 225, r: 5 });
    expect(screen.getByText("How Did It Move?")).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(screen.queryByText("How Did It Move?")).toBeNull();
  });

  it("is not offered on a drop or a done mark", () => {
    sheet({ id: "d1", w: 205, r: 5, drop: true });
    expect(screen.queryByRole("switch", { name: "Warm-up set" })).toBeNull();
  });
});

describe("a converted set in the live session", () => {
  beforeEach(() => { localStorage.clear(); });
  const ex: Exercise = { id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }, { id: "p3", w: 225, r: 5 }] };
  const logged: SetEntry[] = [{ id: "a", w: 135, r: 8 }, { id: "b", w: 225, r: 5 }];
  const live: LiveSession = { programId: "p", dayId: "d1", dayName: "Push", date: "2026-09-29", startedAt: 0, idx: 0,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: logged }] };

  const renderIt = (onSetLogged = vi.fn()) => {
    render(<SessionScreen live={live} exercise={ex} dayExercises={[ex]} programDay={{ id: "d1", name: "Push", exercises: [ex] }}
      history={[]} library={[]} onLog={() => {}} onSetLogged={onSetLogged} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
      onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />);
    return onSetLogged;
  };

  it("tapping a logged row, flipping the switch and saving writes warmup: true to that set alone", () => {
    const onSetLogged = renderIt();
    fireEvent.click(screen.getByLabelText("Set 1 · Done, 135 lb × 8, tap to edit"));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSetLogged).toHaveBeenCalledTimes(1);
    const next = onSetLogged.mock.calls[0]![0] as SetEntry[];
    expect(next[0]).toMatchObject({ id: "a", w: 135, r: 8, warmup: true });
    expect(next[1]).toEqual(logged[1]);
  });

  it("the work sets renumber, and the converted one is scored as no record and no tonnage", () => {
    const flipped: LiveSession = { ...live, exercises: [{ ...live.exercises[0]!, sets: [{ ...logged[0]!, warmup: true }, logged[1]!] }] };
    render(<SessionScreen live={flipped} exercise={ex} dayExercises={[ex]} programDay={{ id: "d1", name: "Push", exercises: [ex] }}
      history={[]} library={[]} onLog={() => {}} onSetLogged={() => {}} onSkip={() => {}} onMove={() => {}} onSwap={() => {}}
      onAddMidSession={() => {}} onFit={() => {}} onFinish={() => {}} onBack={() => {}} />);
    expect(screen.getByLabelText("Warm-Up · Done, 135 lb × 8, tap to edit")).toBeInTheDocument();
    // The 225 that was Set 2 is Set 1 now, and the Now card is Set 2.
    expect(screen.getByLabelText("Set 1 · Done, 225 lb × 5, tap to edit")).toBeInTheDocument();
    expect(screen.getByText("Now · Set 2")).toBeInTheDocument();
    expect(scoreOf("weight_reps", flipped.exercises[0]!.sets[0]!, "lb")).toBeNull();
    expect(setVolume("weight_reps", flipped.exercises[0]!.sets[0]!, "lb")).toBe(0);
    expect(scoreOf("weight_reps", logged[0]!, "lb")).not.toBeNull();
  });
});
