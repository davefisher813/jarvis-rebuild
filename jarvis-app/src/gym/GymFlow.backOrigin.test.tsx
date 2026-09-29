// @vitest-environment jsdom
//
// BACK GOES TO WHERE IT WAS OPENED (audit 2026-09-29). A session opened from
// All Data (or Insights) is named on the way in through startWorkoutId. Its
// Back used to close only the editor, which dropped the athlete on this flow's
// own "5 Day Program" page instead of the All Data list he came from. A
// session reached by walking History keeps its old behaviour: closing it lands
// on History.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { WorkoutData } from "./types";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const T0 = new Date("2026-09-19T12:00:00").getTime();
const DATA: WorkoutData = {
  programId: "p1", dayId: "d1", dayName: "Push Day", date: "2026-09-18",
  startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 47 * 60_000,
  exercises: [{
    exerciseId: "bench", name: "Bench Press", kind: "weight_reps", unit: "lb",
    sets: [{ id: "s0", w: 185, r: 5 }],
  }],
};

beforeEach(() => { localStorage.clear(); });

async function seeded(userId: string) {
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  let id = "";
  const view = render(<NotesProvider userId={userId}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { id = (await gym!.saveWorkout(DATA))!; });
  return { id, rerender: (node: React.ReactNode) => view.rerender(<NotesProvider userId={userId}><Grab />{node}</NotesProvider>) };
}

describe("GymFlow: a session named on the way in goes back to its caller", () => {
  it("Back on a session opened from All Data leaves the flow instead of landing on the program page", async () => {
    const { id, rerender } = await seeded("gym-back-origin-workout");
    const onBack = vi.fn();
    rerender(<GymFlow startWorkoutId={id} onBack={onBack} />);
    // The session's own screen, not the program page that is up first.
    await screen.findByRole("button", { name: "Delete Workout" }, { timeout: 4000 });
    const back = screen.getByRole("button", { name: "Back" });
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(back); });
    expect(onBack, "the caller's page is the way out").toHaveBeenCalledTimes(1);
  });

  it("a session reached by walking History still closes onto History", async () => {
    const { rerender } = await seeded("gym-back-origin-history");
    const onBack = vi.fn();
    rerender(<GymFlow startHistory="sessions" onBack={onBack} />);
    const row = await screen.findByText("Push Day", undefined, { timeout: 4000 });
    await act(async () => { fireEvent.click(row); });
    const back = await screen.findByRole("button", { name: "Back" });
    await act(async () => { fireEvent.click(back); });
    expect(onBack).not.toHaveBeenCalled();
    expect(await screen.findByText("Push Day")).toBeInTheDocument();
  });

  it("Back on a lift opened from Insights leaves the flow", async () => {
    const { rerender } = await seeded("gym-back-origin-lift");
    const onBack = vi.fn();
    rerender(<GymFlow startLift={{ name: "Bench Press", kind: "weight_reps", unit: "lb" }} onBack={onBack} />);
    const back = await screen.findByRole("button", { name: "Back" }, { timeout: 4000 });
    await act(async () => { fireEvent.click(back); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
