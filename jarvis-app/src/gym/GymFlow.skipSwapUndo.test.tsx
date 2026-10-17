// @vitest-environment jsdom
//
// UNDO ON SKIP AND SWAP (2026-10-17, Logging Standard rule 5: no confirmation
// inside a logging flow, a receipt with an Undo that lives at least five
// seconds). Skip This Exercise wrote the flag and moved on with no receipt at
// all; Swap raised a toast with no way back. Driven through the real flow and
// the real store: each tap gets the app's one receipt, and its Undo puts back
// exactly what the tap changed, with the athlete back on the exercise.
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
    { exerciseId: "e2", name: "Barbell Row", kind: "weight_reps", unit: "lb", exerciseKey: "ek-row", sets: [] },
  ],
});

let n = 0;
async function mount() {
  const user = "gym-skip-swap-undo-" + ++n;
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

describe("GymFlow: Undo on Skip This Exercise", () => {
  it("the skip gets a receipt whose Undo takes the flag off and returns to the exercise", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByText("Skip This Exercise"));
    await waitFor(() => expect(readLive()!.exercises[0]!.skipped).toBe(true));
    expect(readLive()!.idx).toBe(1);
    const receipt = toastWith(/Skipped/)!;
    expect(receipt, "a receipt for the skip").toBeTruthy();
    expect(receipt.message).toBe("Skipped Bench Press");
    expect(receipt.actionLabel).toBe("Undo");
    await act(async () => { receipt.onAction!(); });
    expect(readLive()!.exercises[0]!.skipped).toBe(false);
    expect(readLive()!.idx).toBe(0);
    expect(readLive()!.exercises[1], "the other exercise is untouched").toMatchObject({ exerciseId: "e2", sets: [] });
  });
});

describe("GymFlow: Undo on Swap", () => {
  it("the swap gets a receipt whose Undo puts the original back in its slot", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByText("Swap Exercise"));
    fireEvent.change(await screen.findByLabelText("Search Exercises"), { target: { value: "Chest-Supported Row" } });
    fireEvent.click(screen.getByText(/Anyway$/));
    await waitFor(() => expect(readLive()!.exercises[0]!.name).toBe("Chest-Supported Row"));
    expect(readLive()!.exercises).toHaveLength(2);
    const receipt = toastWith(/Swapped/)!;
    expect(receipt.message).toBe("Swapped in Chest-Supported Row");
    expect(receipt.actionLabel).toBe("Undo");
    await act(async () => { receipt.onAction!(); });
    expect(readLive()!.exercises[0]).toMatchObject({ exerciseId: "e1", name: "Bench Press", sets: [] });
    expect(readLive()!.exercises[0]!.custom).toBeUndefined();
    expect(readLive()!.idx).toBe(0);
    expect(readLive()!.exercises).toHaveLength(2);
  });
});
