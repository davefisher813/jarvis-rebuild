// @vitest-environment jsdom
//
// DAVE, 2026-09-27: "Every g is gone" -- a Health card counting 17 sessions
// and 38 exercises over a gym whose History said No Numbers Yet. The gym
// uploaded any waiting workout FIRST and read only after, so one upload that
// never answered held every read behind it. The read goes first now.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { WorkoutData } from "./types";
import { queueFinished } from "./liveSession";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const T0 = new Date("2026-09-19T12:00:00").getTime();
const saved: WorkoutData = {
  programId: "p1", dayId: "d1", dayName: "Push Day", date: "2026-09-18",
  startedAt: T0 - 86_400_000, endedAt: T0 - 86_400_000 + 47 * 60_000,
  exercises: [{ exerciseId: "bench", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [{ id: "s0", w: 185, r: 5 }] }],
};
const waiting: WorkoutData = { ...saved, date: "2026-09-19", dayName: "Pull Day",
  exercises: [{ exerciseId: "row", name: "Barbell Row", kind: "weight_reps", unit: "lb", sets: [{ id: "r0", w: 135, r: 8 }] }] };

beforeEach(() => { localStorage.clear(); });

describe("GymFlow reads before it uploads", () => {
  it("History shows what is saved even while a waiting upload never answers", async () => {
    let gym: GymService | null = null;
    function Grab() { gym = useGym(); return null; }
    const { rerender } = render(<NotesProvider userId="gym-read-first"><Grab /></NotesProvider>);
    await waitFor(() => expect(gym).toBeTruthy());
    await act(async () => { await gym!.saveWorkout(saved); });
    // A workout waiting on this phone, and a send that hangs forever.
    queueFinished(waiting);
    gym!.saveWorkout = () => new Promise<string | null>(() => {});
    rerender(
      <NotesProvider userId="gym-read-first">
        <Grab />
        <GymFlow startHistory="sessions" onBack={() => {}} />
      </NotesProvider>,
    );
    expect(await screen.findByText("Push Day", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("No Sessions Yet")).toBeNull();
  });
});
