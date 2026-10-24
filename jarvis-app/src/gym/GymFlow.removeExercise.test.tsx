// @vitest-environment jsdom
//
// SWIPE AN EXERCISE OUT OF TODAY (Dave, 2026-10-24, live in a workout, THIS WORKOUT list). Driven through the real flow and the real store:
// the row's Remove removes the exercise from the live session only, the program keeps it, and the receipt's Undo brings it back in its slot.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { Exercise, ProgramData } from "./types";
import { readLive, writeLive, type LiveSession } from "./liveSession";
import { todayISO } from "../tasks/grouping";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: () => {} }));
import { showToast } from "../shared/toast";
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

const BENCH: Exercise = { id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "p1", w: 225, r: 5 }] };
const ROW: Exercise = { id: "e2", name: "Barbell Row", kind: "weight_reps", unit: "lb", exerciseKey: "ek-row", sets: [{ id: "p2", w: 185, r: 8 }] };
const PROGRAM: ProgramData = { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [BENCH, ROW] }] }] };
const liveOn = (programId: string): LiveSession => ({
  programId, dayId: "d1", dayName: "Push", date: todayISO(), startedAt: Date.now() - 60_000, lastActivityAt: Date.now(), idx: 0,
  exercises: [
    { exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [] },
    { exerciseId: "e2", name: "Barbell Row", kind: "weight_reps", unit: "lb", exerciseKey: "ek-row", sets: [{ id: "s1", w: 185, r: 8, state: "reported" }] },
  ],
});

let n = 0;
async function mount() {
  const user = "gym-remove-ex-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => {
    const id = (await gym!.createProgram(PROGRAM))!;
    writeLive(liveOn(id));
  });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
  await screen.findByRole("button", { name: "More" }, { timeout: 4000 });
}
const toastWith = (re: RegExp) => vi.mocked(showToast).mock.calls.map((c) => c[0]).find((t) => re.test(t.message));


describe("GymFlow: remove an exercise from today", () => {
  it("the row's Remove drops it from the live session only, with a receipt whose Undo puts it back with its sets", async () => {
    await mount();
    const programId = readLive()!.programId;
    fireEvent.click(await screen.findByRole("button", { name: "Remove Barbell Row" }));
    await waitFor(() => expect(readLive()!.exercises.map((e) => e.exerciseId)).toEqual(["e1"]));
    const receipt = toastWith(/Removed/)!;
    expect(receipt.message).toBe("Removed Barbell Row From Today");
    expect(receipt.actionLabel).toBe("Undo");
    await act(async () => { receipt.onAction!(); });
    expect(readLive()!.exercises.map((e) => e.exerciseId)).toEqual(["e1", "e2"]);
    expect(readLive()!.exercises[1]!.sets, "its logged set comes back with it").toHaveLength(1);
    expect(readLive()!.programId).toBe(programId);
  });

  it("the last exercise on the day cannot be swiped away", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Barbell Row" }));
    await waitFor(() => expect(readLive()!.exercises).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});
