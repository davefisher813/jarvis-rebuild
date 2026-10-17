// @vitest-environment jsdom
//
// ONE RECEIPT, ONE UNDO, BOTH WRITES (2026-10-17, Logging Standard rule 5:
// every write inside a logging flow has an Undo of five seconds or more).
// Logging the first set at the suggested numbers also moves the program's
// plan. GymFlow.acceptSuggestion used to announce that move on a toast of its
// own with no Undo, queued behind the set's receipt, and the receipt's Undo
// restored the sets alone: the plan stayed moved. Driven through the real
// flow and the real stores: the accept hands the session the restore, the one
// receipt says the plan moved, and its Undo puts back the set and the plan.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { Exercise, ProgramData, WorkoutData } from "./types";
import { readLive, writeLive, type LiveSession } from "./liveSession";
import { todayISO } from "../tasks/grouping";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), hideToast: () => {} }));
import { showToast } from "../shared/toast";
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); vi.mocked(showToast).mockClear(); });

// 275 for 6, 8, 8 is a 6 to 8 range; a session of 8, 8, 8 at 275 steps it to
// 280 × 6 (a pair of 2.5 plates on the bar is the 5 jump).
const BENCH: Exercise = {
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", equipment: "barbell",
  sets: [{ id: "p1", w: 275, r: 6 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }],
};
const PROGRAM: ProgramData = { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [BENCH] }] }] };
const ALL_TOP: WorkoutData = {
  programId: "", dayId: "d1", dayName: "Push", date: "2026-10-10", startedAt: 1, endedAt: 2,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [{ id: "h1", w: 275, r: 8 }, { id: "h2", w: 275, r: 8 }, { id: "h3", w: 275, r: 8 }] }],
};
const liveOn = (programId: string): LiveSession => ({
  programId, dayId: "d1", dayName: "Push", date: todayISO(), startedAt: Date.now() - 60_000, lastActivityAt: Date.now(), idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [] }],
});

let n = 0;
async function mount() {
  const user = "gym-accept-undo-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => {
    const id = (await gym!.createProgram(PROGRAM))!;
    await gym!.saveWorkout({ ...ALL_TOP, programId: id });
    writeLive(liveOn(id));
  });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
  return { gym: gym! as GymService };
}

const planOf = async (gym: GymService) => {
  const [p] = await gym.listPrograms(true);
  return p!.data.weeks[0]!.days[0]!.exercises[0]!;
};
const toastWith = (re: RegExp) => vi.mocked(showToast).mock.calls.map((c) => c[0]).find((t) => re.test(t.message));

describe("GymFlow: Undo on the set that accepted a suggestion", () => {
  it("logging the suggested set moves the plan, and the one receipt's Undo puts back the set and the plan", async () => {
    const { gym } = await mount();
    // Prefill (Dave, 2026-10-17): the step is already in the fields, and
    // logging it untouched is the accept.
    fireEvent.click(await screen.findByRole("button", { name: "Log 280 Lb × 6" }, { timeout: 4000 }));
    // The set is logged and the plan moved, stepped to 280 × 6 with its range kept.
    await waitFor(async () => expect((await planOf(gym)).sets.map((s) => [s.w, s.r])).toEqual([[280, 6], [280, 6], [280, 6]]), { timeout: 4000 });
    expect((await planOf(gym)).repRange).toEqual({ low: 6, high: 8 });
    expect(readLive()!.exercises[0]!.sets.map((s) => [s.w, s.r])).toEqual([[280, 6]]);
    // One receipt for the one action, naming both writes, with one Undo.
    const receipt = toastWith(/^Logged/)!;
    expect(receipt.message).toBe("Logged 280 Lb × 6 · Plan Moved");
    expect(receipt.actionLabel).toBe("Undo");
    expect(vi.mocked(showToast).mock.calls.filter((c) => /plan/i.test(c[0].message)), "no second receipt for the move").toHaveLength(1);
    await act(async () => { receipt.onAction!(); });
    // The plan is exactly what it was before the accept, and the set is gone.
    await waitFor(async () => expect(await planOf(gym)).toEqual(BENCH), { timeout: 4000 });
    expect(readLive()!.exercises[0]!.sets).toEqual([]);
  });
});
