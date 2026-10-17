// @vitest-environment jsdom
//
// A STARTER ADOPTED AT THE RACK KEEPS ITS MUSCLES (2026-10-17). The live
// session's Swap and Add Exercise pickers passed no onAdopt, so
// LibraryPickSheet wrote the adoption to GymSettings itself while GymFlow kept
// its own in-memory classStore, re-read only on the delete path. The next
// saveClassStore (classifying any lift) wrote that stale copy whole and the
// adopted starter's primary and secondaries were gone. Every picker adopts
// through the flow's own setters now, and the sheet cannot write on its own.
// Driven through the real flow and the real stores.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import type { Exercise, ProgramData } from "./types";
import { readLive, writeLive, type LiveSession } from "./liveSession";
import { readGymSettings } from "./settings";
import { todayISO } from "../tasks/grouping";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const BENCH: Exercise = {
  id: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench",
  sets: [{ id: "p1", w: 185, r: 5 }, { id: "p2", w: 185, r: 5 }],
};
const PROGRAM: ProgramData = { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [BENCH] }] }] };
const liveOn = (programId: string): LiveSession => ({
  programId, dayId: "d1", dayName: "Push", date: todayISO(), startedAt: Date.now() - 60_000, lastActivityAt: Date.now(), idx: 0,
  exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", exerciseKey: "ek-bench", sets: [] }],
});

let n = 0;
async function mount() {
  const user = "gym-adopt-live-" + ++n;
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => {
    const id = (await gym!.createProgram(PROGRAM))!;
    writeLive(liveOn(id));
  });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
  return { gym: gym! as GymService };
}

describe("GymFlow: a starter adopted from the session's Add Exercise", () => {
  it("keeps its primary and secondaries in GymSettings after another lift is classified", async () => {
    await mount();
    // The program (and so the library) has loaded once the Now card reads the plan.
    await screen.findByRole("button", { name: "Log 185 Lb × 5" }, { timeout: 4000 });
    // Add Exercise, the library first: the catalog's Deadlift is a starter.
    fireEvent.click(screen.getByRole("button", { name: "Add Exercise" }));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "deadlift" } });
    fireEvent.click(screen.getByText("Deadlift"));
    await waitFor(() => expect(readLive()?.exercises.map((e) => e.name)).toEqual(["Bench Press", "Deadlift"]));
    const key = readLive()!.exercises[1]!.exerciseKey!;
    expect(key).toMatch(/^ek/);
    const adopted = () => readGymSettings().classByKey?.[key] as { primary: string[]; secondary: string[] } | undefined;
    expect(adopted()).toMatchObject({ primary: ["back"], secondary: ["glutes", "hamstrings", "forearms"] });
    // Now classify ANOTHER lift: the session is still on Bench Press, whose
    // header chip opens the muscle sheet; Chest, Done writes the class store.
    fireEvent.click(screen.getByRole("button", { name: /^Muscles/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Chest" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect((readGymSettings().classByKey?.["ek-bench"] as { primary: string[] } | undefined)?.primary).toEqual(["chest"]));
    // The adoption survived the write, in both stores.
    expect(adopted()).toMatchObject({ primary: ["back"], secondary: ["glutes", "hamstrings", "forearms"] });
    expect(readGymSettings().muscleByKey?.[key]).toEqual(["back", "glutes", "hamstrings", "forearms"]);
    expect(readGymSettings().createdLifts?.some((c) => c.key === key && c.name === "Deadlift")).toBe(true);
  });
});
