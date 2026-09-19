// @vitest-environment jsdom
//
// DELETE WORKOUT, THE ONE DELETE THAT LOSES A SESSION (button audit,
// 2026-09-19). The audit of all 1,807 controls found this one uncovered:
// nothing anywhere named removeWorkout, so the whole path -- the button, the
// toast, and the Undo that is the only way back -- was unproven.
//
// It matters more than most deletes because of what the comment above it
// says: PRs and history DERIVE from the workout list, so removing a session
// silently rewrites every number downstream. A broken Undo here does not
// lose one row, it loses the record the numbers are computed from.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { WorkoutData } from "./types";
import GymFlow from "./GymFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const T0 = new Date("2026-09-19T12:00:00").getTime();
const DATA: WorkoutData = {
  programId: "p1", dayId: "d1", dayName: "Push Day", date: "2026-09-18",
  startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 47 * 60_000,
  exercises: [{
    exerciseId: "bench", name: "Bench Press", kind: "weight_reps", unit: "lb",
    sets: [{ id: "s0", w: 185, r: 5 }, { id: "s1", w: 185, r: 5 }, { id: "s2", w: 195, r: 3 }],
  }],
};

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });

describe("GymFlow: Delete Workout", () => {
  it("removes the session, and Undo puts the same record back", async () => {
    let gym: GymService | null = null;
    function Grab() { gym = useGym(); return null; }
    let id = "";
    const { rerender } = render(
      <NotesProvider userId="gym-del-workout"><Grab /></NotesProvider>,
    );
    await waitFor(() => expect(gym).toBeTruthy());
    await act(async () => { id = (await gym!.saveWorkout(DATA))!; });
    expect(id).toBeTruthy();

    rerender(
      <NotesProvider userId="gym-del-workout">
        <Grab />
        <GymFlow startWorkoutId={id} onBack={() => {}} />
      </NotesProvider>,
    );

    const del = await screen.findByRole("button", { name: "Delete Workout" }, { timeout: 4000 });
    await act(async () => { fireEvent.click(del); });

    // Gone from the store, not merely gone from the screen.
    const find = async () => (await gym!.listWorkouts()).find((w) => w.id === id) ?? null;
    await waitFor(async () => expect(await find()).toBeNull());

    // The toast is the only way back, so it has to be there and it has to work.
    const call = showToast.mock.calls
      .map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => Promise<void> })
      .find((c) => c.message === "Workout deleted");
    expect(call).toBeTruthy();
    expect(call!.actionLabel).toBe("Undo");

    await act(async () => { await call!.onAction!(); });
    // Undo re-CREATES the session rather than restoring the row, so it comes
    // back under a new id. That is safe here and only here: nothing persists a
    // workout id -- every workoutId in the app (chartData, Insights, the
    // Health finding that opens a session) is derived from the list at render
    // time, so the numbers recompute against whatever id the row now has.
    const back = (await gym!.listWorkouts()).find((w) => w.data.dayName === "Push Day") ?? null;
    expect(back).toBeTruthy();
    expect(back!.data.dayName).toBe("Push Day");
    expect(back!.data.exercises[0]!.sets).toHaveLength(3);
    expect(back!.data.endedAt).toBe(DATA.endedAt);
  });
});
